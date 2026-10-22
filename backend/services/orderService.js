import sql from '../db.js';
import {
    ORDER_ACTION,
    ORDER_STATUS,
    PICKUP_WINDOW_DAYS,
    CURRENT_TERMS_VERSION,
    OrderConflictError,
    OrderValidationError,
    getNextOrderStatus,
    normalizeCartQuantity,
    normalizeLoanDuration,
    normalizeReturnItems,
    normalizeReturnNotes,
    normalizeRenewalJustification,
    validateRenewalDate,
    validatePickupDeadline,
    normalizeOrderJustification,
    validateTransitionReason
} from './orderRules.js';
import { enqueueNotification, enqueueStaffNotification } from './notificationService.js';
import { applyLateReturnPenalty } from './accountService.js';
import { assertAccountIsActive } from './accountValidation.js';
import { recordInventoryUsage } from './inventoryUsage.js';

export class OrderNotFoundError extends Error {}
export { OrderConflictError } from './orderRules.js';

function normalizeId(value, label) {
    const id = Number(value);

    if (!Number.isSafeInteger(id) || id < 1) {
        throw new OrderValidationError(`${label} inválido.`);
    }

    return id;
}

const _orderStatusCache = new Map();
const _productStatusCache = new Map();

async function getOrderStatusId(db, status) {
    const key = status.toLowerCase();
    if (_orderStatusCache.has(key)) return _orderStatusCache.get(key);

    const [row] = await db`
        SELECT id_status
        FROM status_pedido
        WHERE lower(descricao_status) = lower(${status})
        LIMIT 1
    `;

    if (!row) {
        throw new Error(`Status de pedido não configurado: ${status}. Aplique a migration do fluxo de pedidos.`);
    }

    _orderStatusCache.set(key, row.id_status);
    return row.id_status;
}

async function getProductStatusId(db, status) {
    const key = status.toLowerCase();
    if (_productStatusCache.has(key)) return _productStatusCache.get(key);

    const [row] = await db`
        SELECT id_statusproduto
        FROM status_produto
        WHERE lower(status_produto) = lower(${status})
        LIMIT 1
    `;

    if (!row) {
        throw new Error(`Status de produto não configurado: ${status}.`);
    }

    _productStatusCache.set(key, row.id_statusproduto);
    return row.id_statusproduto;
}

async function getLockedOrderItems(db, orderId) {
    return db`
        SELECT
            item.id_produto,
            item.qnt_solicitada,
            item.qnt_devolvida,
            item.qnt_danificada,
            produto.nome,
            produto.estoque_total,
            produto.id_statusproduto,
            status_produto.status_produto
        FROM contem_lista item
        INNER JOIN produto ON produto.id_produto = item.id_produto
        INNER JOIN status_produto ON status_produto.id_statusproduto = produto.id_statusproduto
        WHERE item.id_pedido = ${orderId}
        ORDER BY produto.id_produto
        FOR UPDATE OF produto
    `;
}

async function restoreOrderItemsStock(db, orderId) {
    const items = await getLockedOrderItems(db, orderId);
    const availableStatusId = await getProductStatusId(db, 'Disponível');

    for (const item of items) {
        await db`
            UPDATE produto
            SET
                estoque_total = estoque_total + ${item.qnt_solicitada - item.qnt_devolvida},
                id_statusproduto = ${item.status_produto === 'Arquivado'
                    ? item.id_statusproduto
                    : availableStatusId}
            WHERE id_produto = ${item.id_produto}
        `;
    }

    return items;
}

async function queryOrders(db, { orderId = null, userId = null, status = '' } = {}) {
    return db`
        SELECT
            pedido.id_pedido,
            pedido.data_pedido,
            pedido.data_aprovacao,
            pedido.data_aprovacao + ${PICKUP_WINDOW_DAYS}::int AS data_limite_retirada,
            pedido.data_retirada,
            pedido.data_devolucao,
            CASE
                WHEN pedido.data_retirada IS NOT NULL
                THEN greatest(pedido.data_retirada + pedido.duracao_dias, (
                    SELECT max(renovacao.data_estendida) FROM renovacao
                    JOIN renovacao_pedido USING (id_renovacao)
                    WHERE renovacao_pedido.id_pedido = pedido.id_pedido AND renovacao.status = 'Aprovada'
                ))
                ELSE NULL
            END::text AS data_prevista_devolucao,
            pedido.duracao_dias,
            pedido.estado_termo,
            pedido.timestamp_termo,
            pedido.justificativa,
            pedido.motivo_recusa,
            pedido.id_usuario,
            status_pedido.descricao_status AS status,
            usuario.nome AS usuario_nome,
            usuario.email AS usuario_email,
            COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'id_produto', item.id_produto,
                            'qnt_solicitada', item.qnt_solicitada,
                            'qnt_devolvida', item.qnt_devolvida,
                            'qnt_danificada', item.qnt_danificada,
                            'nome', produto.nome,
                            'cor', produto.cor,
                            'foto_produto', produto.foto_produto
                        )
                        ORDER BY lower(produto.nome), produto.id_produto
                    )
                    FROM contem_lista item
                    INNER JOIN produto ON produto.id_produto = item.id_produto
                    WHERE item.id_pedido = pedido.id_pedido
                ),
                '[]'::jsonb
            ) AS itens,
            COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'id_renovacao', renovacao.id_renovacao, 'status', renovacao.status,
                    'data_estendida', renovacao.data_estendida,
                    'justificativa_estendimento', renovacao.justificativa_estendimento,
                    'data_solicitacao', renovacao.data_solicitacao,
                    'data_resposta', renovacao.data_resposta, 'motivo_recusa', renovacao.motivo_recusa
                ) ORDER BY renovacao.id_renovacao)
                FROM renovacao JOIN renovacao_pedido USING (id_renovacao)
                WHERE renovacao_pedido.id_pedido = pedido.id_pedido
            ), '[]'::jsonb) AS renovacoes,
            COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'data', log."timestamp",
                    'observacao', log.dados_posteriores::jsonb ->> 'observacao',
                    'itens', COALESCE(log.dados_posteriores::jsonb -> 'devolucao', '[]'::jsonb)
                ) ORDER BY log.id_log)
                FROM log_auditoria log
                WHERE log.acao = 'pedido:register_return'
                  AND (log.dados_posteriores::jsonb ->> 'id_pedido') = pedido.id_pedido::text
            ), '[]'::jsonb) AS devolucoes
        FROM pedido
        INNER JOIN status_pedido ON status_pedido.id_status = pedido.id_status
        INNER JOIN usuario ON usuario.id_usuario = pedido.id_usuario
        WHERE (${orderId}::bigint IS NULL OR pedido.id_pedido = ${orderId})
          AND (${userId}::bigint IS NULL OR pedido.id_usuario = ${userId})
          AND (${status} = '' OR lower(status_pedido.descricao_status) = lower(${status}))
        ORDER BY pedido.data_pedido DESC, pedido.id_pedido DESC
    `;
}

async function getOrderById(db, orderId) {
    const [order] = await queryOrders(db, { orderId });

    if (!order) {
        throw new OrderNotFoundError('Pedido não encontrado.');
    }

    return order;
}

export async function getCart(userId) {
    const normalizedUserId = normalizeId(userId, 'Usuário');

    return sql`
        SELECT
            carrinho.id_produto,
            carrinho.quantidade,
            carrinho.data_adicao,
            produto.nome,
            produto.descricao_produto,
            produto.cor,
            produto.foto_produto,
            produto.estoque_total,
            status_produto.status_produto
        FROM lista_de_desejos carrinho
        INNER JOIN produto ON produto.id_produto = carrinho.id_produto
        INNER JOIN status_produto ON status_produto.id_statusproduto = produto.id_statusproduto
        WHERE carrinho.id_usuario = ${normalizedUserId}
        ORDER BY carrinho.data_adicao, lower(produto.nome), produto.id_produto
    `;
}

async function lockUserCart(db, userId) {
    // Alterações do carrinho e checkout precisam observar a mesma sequência de gravações.
    const [user] = await db`SELECT id_usuario, status_conta,
        COALESCE(bloqueio_automatico_ate > current_date, false) AS bloqueio_automatico_ativo,
        bloqueio_automatico_ate::text
        FROM usuario WHERE id_usuario = ${userId} FOR NO KEY UPDATE`;
    assertAccountIsActive(user);
}

async function lockOrderUsers(db, orderId, actorId) {
    const [owner] = await db`SELECT id_usuario FROM pedido WHERE id_pedido = ${orderId}`;
    if (owner) {
        // Carrinho e penalidade usam a mesma ordem de travas: usuários antes de produtos.
        await db`SELECT id_usuario FROM usuario WHERE id_usuario IN (${owner.id_usuario}, ${actorId})
            ORDER BY id_usuario FOR NO KEY UPDATE`;
    }
}

export async function addCartItem(userId, productId, quantity = 1) {
    const normalizedUserId = normalizeId(userId, 'Usuário');
    const normalizedProductId = normalizeId(productId, 'Item');

    return sql.begin(async (db) => {
        await lockUserCart(db, normalizedUserId);
        const [product] = await db`
            SELECT produto.estoque_total, status_produto.status_produto
            FROM produto
            INNER JOIN status_produto ON status_produto.id_statusproduto = produto.id_statusproduto
            WHERE produto.id_produto = ${normalizedProductId}
            FOR UPDATE OF produto
        `;

        if (!product || product.status_produto !== 'Disponível') {
            throw new OrderNotFoundError('Item indisponível para empréstimo.');
        }

        const [existingItem] = await db`
            SELECT quantidade
            FROM lista_de_desejos
            WHERE id_usuario = ${normalizedUserId}
              AND id_produto = ${normalizedProductId}
            FOR UPDATE
        `;
        const requestedQuantity = normalizeCartQuantity(quantity, product.estoque_total);
        const nextQuantity = (existingItem?.quantidade || 0) + requestedQuantity;
        normalizeCartQuantity(nextQuantity, product.estoque_total);

        const [item] = await db`
            INSERT INTO lista_de_desejos (id_usuario, id_produto, quantidade, data_adicao)
            VALUES (${normalizedUserId}, ${normalizedProductId}, ${nextQuantity}, current_date)
            ON CONFLICT (id_produto, id_usuario)
            DO UPDATE SET quantidade = excluded.quantidade, data_adicao = current_date
            RETURNING id_usuario, id_produto, quantidade, data_adicao
        `;

        return item;
    });
}

export async function updateCartItem(userId, productId, quantity) {
    const normalizedUserId = normalizeId(userId, 'Usuário');
    const normalizedProductId = normalizeId(productId, 'Item');

    return sql.begin(async (db) => {
        await lockUserCart(db, normalizedUserId);
        const [product] = await db`
            SELECT produto.estoque_total, status_produto.status_produto
            FROM produto
            INNER JOIN status_produto ON status_produto.id_statusproduto = produto.id_statusproduto
            WHERE produto.id_produto = ${normalizedProductId}
            FOR UPDATE OF produto
        `;

        if (!product || product.status_produto !== 'Disponível') {
            throw new OrderNotFoundError('Item indisponível para empréstimo.');
        }

        const normalizedQuantity = normalizeCartQuantity(quantity, product.estoque_total);
        const [item] = await db`
            UPDATE lista_de_desejos
            SET quantidade = ${normalizedQuantity}
            WHERE id_usuario = ${normalizedUserId}
              AND id_produto = ${normalizedProductId}
            RETURNING id_usuario, id_produto, quantidade, data_adicao
        `;

        if (!item) {
            throw new OrderNotFoundError('Item não encontrado no carrinho.');
        }

        return item;
    });
}

export async function removeCartItem(userId, productId) {
    const normalizedUserId = normalizeId(userId, 'Usuário');
    const normalizedProductId = normalizeId(productId, 'Item');
    return sql.begin(async (db) => {
        await lockUserCart(db, normalizedUserId);
        const [item] = await db`
            DELETE FROM lista_de_desejos
            WHERE id_usuario = ${normalizedUserId}
              AND id_produto = ${normalizedProductId}
            RETURNING id_produto
        `;
        if (!item) {
            throw new OrderNotFoundError('Item não encontrado no carrinho.');
        }
        return item;
    });
}

export async function checkoutCart(userId, { durationDays, acceptedTerms, termsVersion, justification, reservationStart, reservationEnd }) {
    const normalizedUserId = normalizeId(userId, 'Usuário');
    const duration = normalizeLoanDuration(durationDays);
    const normalizedJustification = normalizeOrderJustification(justification);

    if (reservationStart || reservationEnd) {
        throw new OrderValidationError('O agendamento por datas foi removido. Informe apenas a duração do empréstimo.');
    }

    if (acceptedTerms !== true) {
        throw new OrderValidationError('É necessário aceitar o termo de responsabilidade.');
    }
    if (termsVersion !== CURRENT_TERMS_VERSION) {
        throw new OrderValidationError('O termo de responsabilidade foi atualizado. Recarregue a página, leia a versão atual e aceite novamente.');
    }

    await expireUncollectedOrders();
    return sql.begin(async (db) => {

        await lockUserCart(db, normalizedUserId);

        const [activeOrders] = await db`
            SELECT count(*)::int AS total
            FROM pedido
            INNER JOIN status_pedido ON status_pedido.id_status = pedido.id_status
            WHERE pedido.id_usuario = ${normalizedUserId}
              AND lower(status_pedido.descricao_status) NOT IN ('devolvido', 'negado', 'cancelado', 'expirado')
        `;

        if (activeOrders.total >= 3) {
            throw new OrderConflictError('Você já possui o limite de três pedidos ativos.');
        }

        const cartItems = await db`
            SELECT
                carrinho.id_produto,
                carrinho.quantidade,
                produto.nome,
                produto.estoque_total,
                status_produto.status_produto
            FROM lista_de_desejos carrinho
            INNER JOIN produto ON produto.id_produto = carrinho.id_produto
            INNER JOIN status_produto ON status_produto.id_statusproduto = produto.id_statusproduto
            WHERE carrinho.id_usuario = ${normalizedUserId}
            ORDER BY produto.id_produto
            FOR UPDATE OF produto
        `;

        if (cartItems.length === 0) {
            throw new OrderValidationError('Adicione pelo menos um item ao carrinho.');
        }

        cartItems.forEach((item) => {
            if (item.status_produto !== 'Disponível') {
                throw new OrderConflictError(`O item "${item.nome}" não está mais disponível.`);
            }

            normalizeCartQuantity(item.quantidade, item.estoque_total);
        });

        const pendingStatusId = await getOrderStatusId(db, ORDER_STATUS.PENDING);
        const [order] = await db`
            INSERT INTO pedido (
                id_usuario,
                id_status,
                duracao_dias,
                estado_termo,
                timestamp_termo,
                versao_termo,
                justificativa
            )
            VALUES (
                ${normalizedUserId},
                ${pendingStatusId},
                ${duration},
                true,
                now(),
                ${termsVersion},
                ${normalizedJustification}
            )
            RETURNING id_pedido
        `;

        const availableStatusId = await getProductStatusId(db, 'Disponível');
        const unavailableStatusId = await getProductStatusId(db, 'Indisponível');

        for (const item of cartItems) {
            const nextStock = item.estoque_total - item.quantidade;
            await db`
                UPDATE produto
                SET
                    estoque_total = ${nextStock},
                    id_statusproduto = ${nextStock > 0 ? availableStatusId : unavailableStatusId}
                WHERE id_produto = ${item.id_produto}
            `;

            await db`
                INSERT INTO contem_lista (id_pedido, id_produto, qnt_solicitada, qnt_devolvida)
                VALUES (${order.id_pedido}, ${item.id_produto}, ${item.quantidade}, 0)
            `;
        }

        await db`DELETE FROM lista_de_desejos WHERE id_usuario = ${normalizedUserId}`;
        await recordInventoryUsage(db, cartItems.map(item => item.id_produto), 'pedido:checkout');
        return getOrderById(db, order.id_pedido);
    });
}

export async function listUserOrders(userId) {
    const normalizedUserId = normalizeId(userId, 'Usuário');
    await expireUncollectedOrders();
    return queryOrders(sql, { userId: normalizedUserId });
}

export async function repeatOrder(userId, orderId, { ip } = {}) {
    const normalizedUserId = normalizeId(userId, 'Usuário');
    const normalizedOrderId = normalizeId(orderId, 'Pedido');
    return sql.begin(async db => {
        await lockUserCart(db, normalizedUserId);
        const [order] = await db`SELECT id_pedido FROM pedido
            WHERE id_pedido = ${normalizedOrderId} AND id_usuario = ${normalizedUserId}`;
        if (!order) throw new OrderNotFoundError('Pedido não encontrado.');
        const items = await getLockedOrderItems(db, normalizedOrderId);
        const warnings = [], copied = [];
        let addedQuantity = 0;
        for (const item of items) {
            if (item.status_produto !== 'Disponível' || item.estoque_total < 1) {
                warnings.push(`${item.nome}: ${item.status_produto === 'Arquivado' ? 'item arquivado' : 'sem estoque disponível'}, não adicionado.`);
                continue;
            }
            const [existing] = await db`SELECT quantidade FROM lista_de_desejos
                WHERE id_usuario = ${normalizedUserId} AND id_produto = ${item.id_produto}`;
            const current = existing?.quantidade || 0;
            const quantity = Math.min(current + item.qnt_solicitada, item.estoque_total);
            const added = Math.max(0, quantity - current);
            if (quantity < current + item.qnt_solicitada) {
                warnings.push(`${item.nome}: adicionada(s) ${added} de ${item.qnt_solicitada} unidade(s); o carrinho ficou com ${quantity}, conforme o estoque disponível.`);
            }
            await db`INSERT INTO lista_de_desejos (id_usuario, id_produto, quantidade, data_adicao)
                VALUES (${normalizedUserId}, ${item.id_produto}, ${quantity}, current_date)
                ON CONFLICT (id_produto, id_usuario) DO UPDATE SET quantidade = excluded.quantidade`;
            addedQuantity += added;
            copied.push({ id_produto: item.id_produto, quantidade_anterior: current, quantidade: quantity });
        }
        await recordOrderAudit(db, { actorUserId: normalizedUserId, orderId: normalizedOrderId,
            action: 'repeat', nextItems: copied, ip });
        return { addedQuantity, warnings };
    });
}

async function lockRenewableOrder(db, orderId, userId = null) {
    const [order] = await db`SELECT pedido.id_pedido, pedido.id_usuario, descricao_status AS status,
        current_date::text AS today
        FROM pedido JOIN status_pedido USING (id_status)
        WHERE id_pedido = ${orderId} AND (${userId}::bigint IS NULL OR id_usuario = ${userId})
        FOR UPDATE OF pedido`;
    if (!order) throw new OrderNotFoundError('Pedido não encontrado.');
    if (order.status !== ORDER_STATUS.PICKED_UP) {
        throw new OrderConflictError('Somente pedidos retirados podem ser renovados.');
    }
    return { ...await getOrderById(db, orderId), today: order.today };
}

export async function requestOrderRenewal(userId, orderId, { requestedDate, justification, ip } = {}) {
    const normalizedUserId = normalizeId(userId, 'Usuário');
    const normalizedOrderId = normalizeId(orderId, 'Pedido');
    const normalizedJustification = normalizeRenewalJustification(justification);
    return sql.begin(async db => {
        await lockUserCart(db, normalizedUserId);
        const order = await lockRenewableOrder(db, normalizedOrderId, normalizedUserId);
        if (order.renovacoes.some(renewal => renewal.status === 'Pendente')) {
            throw new OrderConflictError('Este pedido já possui uma renovação pendente de análise.');
        }
        if (order.renovacoes.filter(renewal => renewal.status === 'Aprovada').length >= 2) {
            throw new OrderConflictError('Este pedido já atingiu o limite de duas renovações aprovadas.');
        }
        const date = validateRenewalDate(requestedDate, String(order.data_prevista_devolucao).slice(0, 10), order.today);
        const [renewal] = await db`INSERT INTO renovacao (data_estendida, justificativa_estendimento)
            VALUES (${date}, ${normalizedJustification}) RETURNING id_renovacao`;
        await db`INSERT INTO renovacao_pedido (id_renovacao, id_pedido) VALUES (${renewal.id_renovacao}, ${normalizedOrderId})`;
        await recordOrderAudit(db, { actorUserId: normalizedUserId, orderId: normalizedOrderId,
            action: 'request_renewal', previousStatus: order.status, nextStatus: order.status,
            renewal: { id_renovacao: renewal.id_renovacao, data_estendida: date, justificativa: normalizedJustification }, ip });
        await enqueueStaffNotification(db, { eventKey: `renovacao:${renewal.id_renovacao}:requested`,
            message: `${order.usuario_nome} solicitou renovação do pedido #${normalizedOrderId} até ${date.split('-').reverse().join('/')}.`, href: '/pedidos.html' });
        return getOrderById(db, normalizedOrderId);
    });
}

export async function decideOrderRenewal(actorUserId, orderId, renewalId, { approved, reason, ip } = {}) {
    const actor = normalizeId(actorUserId, 'Usuário');
    const id = normalizeId(orderId, 'Pedido');
    const renewal = normalizeId(renewalId, 'Renovação');
    if (typeof approved !== 'boolean') throw new OrderValidationError('Informe se a renovação foi aprovada ou negada.');
    const normalizedReason = approved ? null : validateTransitionReason(ORDER_ACTION.DENY, reason);
    return sql.begin(async db => {
        await lockOrderUsers(db, id, actor);
        const order = await lockRenewableOrder(db, id);
        const pending = order.renovacoes.find(item => String(item.id_renovacao) === String(renewal));
        if (!pending) throw new OrderNotFoundError('Renovação não encontrada neste pedido.');
        if (pending.status !== 'Pendente') throw new OrderConflictError('Esta renovação já foi analisada. Recarregue o pedido.');
        if (approved) {
            if (order.renovacoes.filter(item => item.status === 'Aprovada').length >= 2) {
                throw new OrderConflictError('Este pedido já atingiu o limite de duas renovações aprovadas.');
            }
            validateRenewalDate(pending.data_estendida, String(order.data_prevista_devolucao).slice(0, 10), order.today);
        }
        const status = approved ? 'Aprovada' : 'Negada';
        await db`UPDATE renovacao SET status = ${status}, data_resposta = current_date,
            motivo_recusa = ${normalizedReason}, id_decisor = ${actor} WHERE id_renovacao = ${renewal}`;
        await recordOrderAudit(db, { actorUserId: actor, orderId: id, action: approved ? 'approve_renewal' : 'deny_renewal',
            previousStatus: order.status, nextStatus: order.status,
            renewal: { id_renovacao: renewal, status, motivo_recusa: normalizedReason, data_estendida: pending.data_estendida }, ip });
        await enqueueNotification(db, { userId: order.id_usuario, eventKey: `renovacao:${renewal}:decided`,
            message: approved ? `A renovação do pedido #${id} foi aprovada. Devolva até ${pending.data_estendida.split('-').reverse().join('/')}.`
                : `A renovação do pedido #${id} foi negada. Motivo: ${normalizedReason}`, href: '/pedidos' });
        return getOrderById(db, id);
    });
}

export async function cancelUserOrder(userId, orderId, { ip } = {}) {
    const normalizedUserId = normalizeId(userId, 'Usuário');
    const normalizedOrderId = normalizeId(orderId, 'Pedido');
    await expireUncollectedOrders();

    return sql.begin(async (db) => {
        const [order] = await db`
            SELECT pedido.id_pedido, pedido.id_status, status_pedido.descricao_status AS status
            FROM pedido
            INNER JOIN status_pedido ON status_pedido.id_status = pedido.id_status
            WHERE pedido.id_pedido = ${normalizedOrderId}
              AND pedido.id_usuario = ${normalizedUserId}
            FOR UPDATE OF pedido
        `;

        if (!order) {
            throw new OrderNotFoundError('Pedido não encontrado.');
        }

        const nextStatus = getNextOrderStatus(order.status, ORDER_ACTION.CANCEL);
        const nextStatusId = await getOrderStatusId(db, nextStatus);

        const items = await restoreOrderItemsStock(db, normalizedOrderId);

        await db`
            UPDATE pedido
            SET id_status = ${nextStatusId}
            WHERE id_pedido = ${normalizedOrderId}
        `;
        await recordInventoryUsage(db, items.map(item => item.id_produto), 'pedido:cancel');
        await recordOrderAudit(db, {
            actorUserId: normalizedUserId,
            orderId: normalizedOrderId,
            action: ORDER_ACTION.CANCEL,
            previousStatus: order.status,
            nextStatus,
            ip
        });

        return getOrderById(db, normalizedOrderId);
    });
}

export async function listManagedOrders(status = '') {
    const normalizedStatus = typeof status === 'string' ? status.trim() : '';
    await expireUncollectedOrders();
    return queryOrders(sql, { status: normalizedStatus });
}

export async function expireUncollectedOrders() {
    const expired = await sql`
        SELECT pedido.id_pedido
        FROM pedido JOIN status_pedido USING (id_status)
        WHERE descricao_status IN ('Aprovado', 'Em separação', 'Pronto para retirada')
          AND data_retirada IS NULL
          AND current_date > data_aprovacao + ${PICKUP_WINDOW_DAYS}::int
        ORDER BY pedido.id_pedido
    `;
    for (const { id_pedido } of expired) {
        // Uma transação por pedido evita manter travas de estoque de vários pedidos ao mesmo tempo.
        await sql.begin(async db => {
            const [order] = await db`
                SELECT pedido.id_pedido, pedido.id_usuario, status_pedido.descricao_status AS status
                FROM pedido JOIN status_pedido USING (id_status)
                WHERE pedido.id_pedido = ${id_pedido}
                  AND descricao_status IN ('Aprovado', 'Em separação', 'Pronto para retirada')
                  AND data_retirada IS NULL
                  AND current_date > data_aprovacao + ${PICKUP_WINDOW_DAYS}::int
                FOR UPDATE OF pedido SKIP LOCKED
            `;
            if (!order) return;
            const statusId = await getOrderStatusId(db, ORDER_STATUS.EXPIRED);
            const items = await restoreOrderItemsStock(db, id_pedido);
            await db`UPDATE pedido SET id_status = ${statusId} WHERE id_pedido = ${id_pedido}`;
            await recordInventoryUsage(db, items.map(item => item.id_produto), 'pedido:expire');
            await recordOrderAudit(db, {
                actorUserId: null, orderId: id_pedido, action: 'expire',
                previousStatus: order.status, nextStatus: ORDER_STATUS.EXPIRED
            });
            await enqueueNotification(db, {
                userId: order.id_usuario, eventKey: `pedido:${id_pedido}:expire`,
                message: `O pedido #${id_pedido} expirou porque não foi retirado no prazo de 10 dias.`, href: '/pedidos'
            });
        });
    }
}

async function recordOrderAudit(db, {
    actorUserId,
    orderId,
    action,
    previousStatus,
    nextStatus,
    ip,
    previousItems,
    nextItems,
    returnItems,
    returnNotes,
    renewal
}) {
    const [audit] = await db`
        INSERT INTO log_auditoria (
            acao,
            tabela_afetada,
            dados_anteriores,
            dados_posteriores,
            ip,
            id_usuario
        )
        VALUES (
            ${`pedido:${action}`},
            'pedido',
            ${JSON.stringify({ id_pedido: orderId, status: previousStatus, itens: previousItems })},
            ${JSON.stringify({ id_pedido: orderId, status: nextStatus, itens: nextItems, devolucao: returnItems, observacao: returnNotes, renovacao: renewal })},
            ${ip || null},
            ${actorUserId}
        )
        RETURNING id_log
    `;
    return audit.id_log;
}

export async function transitionOrder(actorUserId, orderId, action, { reason, ip, returnItems, returnNotes } = {}) {
    if (action === ORDER_ACTION.CANCEL) {
        throw new OrderValidationError('Somente o solicitante pode cancelar o pedido.');
    }

    const normalizedActorUserId = normalizeId(actorUserId, 'Usuário');
    const normalizedOrderId = normalizeId(orderId, 'Pedido');
    const normalizedReason = validateTransitionReason(action, reason);
    const normalizedReturnNotes = action === ORDER_ACTION.REGISTER_RETURN ? normalizeReturnNotes(returnNotes) : null;
    await expireUncollectedOrders();

    return sql.begin(async (db) => {
        if (action === ORDER_ACTION.REGISTER_RETURN) {
            await lockOrderUsers(db, normalizedOrderId, normalizedActorUserId);
        }
        const [order] = await db`
            SELECT
                pedido.id_pedido,
                pedido.id_status,
                pedido.id_usuario,
                pedido.duracao_dias,
                pedido.data_aprovacao::text,
                greatest(pedido.data_retirada + pedido.duracao_dias, (
                    SELECT max(renovacao.data_estendida) FROM renovacao
                    JOIN renovacao_pedido USING (id_renovacao)
                    WHERE renovacao_pedido.id_pedido = pedido.id_pedido AND renovacao.status = 'Aprovada'
                ))::text AS data_prevista_devolucao,
                current_date::text AS today,
                status_pedido.descricao_status AS status
            FROM pedido
            INNER JOIN status_pedido ON status_pedido.id_status = pedido.id_status
            WHERE pedido.id_pedido = ${normalizedOrderId}
            FOR UPDATE OF pedido
        `;

        if (!order) {
            throw new OrderNotFoundError('Pedido não encontrado.');
        }

        let nextStatus = getNextOrderStatus(order.status, action);
        if (action === ORDER_ACTION.CONFIRM_PICKUP) validatePickupDeadline(order.data_aprovacao, order.today);
        let previousItems, nextItems, receivedItems, inventoryItems;
        if (action === ORDER_ACTION.REGISTER_RETURN) {
            const items = await getLockedOrderItems(db, normalizedOrderId);
            inventoryItems = items;
            receivedItems = normalizeReturnItems(items, returnItems);
            previousItems = items.map(item => ({
                id_produto: item.id_produto, qnt_devolvida: item.qnt_devolvida, qnt_danificada: item.qnt_danificada
            }));
            nextItems = previousItems.map(item => {
                const received = receivedItems.find(received => received.id_produto === item.id_produto);
                return { ...item, qnt_devolvida: item.qnt_devolvida + (received?.quantidade || 0),
                    qnt_danificada: item.qnt_danificada + (received?.danificada || 0) };
            });
            const complete = items.every(item => nextItems.find(next => next.id_produto === item.id_produto).qnt_devolvida === item.qnt_solicitada);
            nextStatus = complete ? ORDER_STATUS.RETURNED : ORDER_STATUS.PICKED_UP;
            const availableStatusId = await getProductStatusId(db, 'Disponível');
            for (const received of receivedItems) {
                const product = items.find(item => item.id_produto === received.id_produto);
                const usable = received.quantidade - received.danificada;
                if (usable > 0) {
                    await db`UPDATE produto SET estoque_total = estoque_total + ${usable},
                        id_statusproduto = ${product.status_produto === 'Arquivado' ? product.id_statusproduto : availableStatusId}
                        WHERE id_produto = ${received.id_produto}`;
                }
                await db`UPDATE contem_lista
                    SET qnt_devolvida = qnt_devolvida + ${received.quantidade},
                        qnt_danificada = qnt_danificada + ${received.danificada},
                        status_item = CASE WHEN qnt_devolvida + ${received.quantidade} = qnt_solicitada THEN 'Devolvido' ELSE 'Parcial' END
                    WHERE id_pedido = ${normalizedOrderId} AND id_produto = ${received.id_produto}`;
            }
        }
        const nextStatusId = await getOrderStatusId(db, nextStatus);

        if (action === ORDER_ACTION.DENY) {
            inventoryItems = await restoreOrderItemsStock(db, normalizedOrderId);
        }

        if (action === ORDER_ACTION.REGISTER_RETURN) {
            await db`
                UPDATE pedido
                SET
                    id_status = ${nextStatusId},
                    data_devolucao = CASE WHEN ${nextStatus === ORDER_STATUS.RETURNED} THEN current_date ELSE NULL END
                WHERE id_pedido = ${normalizedOrderId}
            `;
        } else if (action === ORDER_ACTION.CONFIRM_PICKUP) {
            inventoryItems = await getLockedOrderItems(db, normalizedOrderId);
            await db`
                UPDATE pedido
                SET
                    id_status = ${nextStatusId},
                    motivo_recusa = ${normalizedReason},
                    data_retirada = current_date,
                    data_devolucao = NULL
                WHERE id_pedido = ${normalizedOrderId}
            `;
        } else if (action === ORDER_ACTION.APPROVE) {
            await db`
                UPDATE pedido SET id_status = ${nextStatusId}, data_aprovacao = current_date
                WHERE id_pedido = ${normalizedOrderId}
            `;
        } else {
            await db`
                UPDATE pedido
                SET
                    id_status = ${nextStatusId},
                    motivo_recusa = ${normalizedReason}
                WHERE id_pedido = ${normalizedOrderId}
            `;
        }
        if (inventoryItems) {
            await recordInventoryUsage(db, inventoryItems.map(item => item.id_produto), `pedido:${action}`);
        }
        const auditId = await recordOrderAudit(db, {
            actorUserId: normalizedActorUserId,
            orderId: normalizedOrderId,
            action,
            previousStatus: order.status,
            nextStatus,
            ip,
            previousItems,
            nextItems,
            returnItems: receivedItems?.map(item => ({ ...item, id_produto: Number(item.id_produto) })),
            returnNotes: normalizedReturnNotes
        });

        if (action === ORDER_ACTION.REGISTER_RETURN && nextStatus === ORDER_STATUS.RETURNED) {
            await db`UPDATE renovacao SET status = 'Cancelada', data_resposta = current_date,
                motivo_recusa = 'Pedido devolvido antes da análise da renovação.'
                WHERE id_renovacao IN (SELECT id_renovacao FROM renovacao_pedido WHERE id_pedido = ${normalizedOrderId})
                  AND status = 'Pendente'`;
            await applyLateReturnPenalty(db, { userId: order.id_usuario, orderId: normalizedOrderId,
                dueDate: order.data_prevista_devolucao, actorId: normalizedActorUserId, ip });
        }
        const messages = {
            approve: `O pedido #${normalizedOrderId} foi aprovado. Você tem 10 dias corridos para retirar.`,
            deny: `O pedido #${normalizedOrderId} foi negado. Motivo: ${normalizedReason}`,
            mark_ready: `O pedido #${normalizedOrderId} está pronto para retirada. Confira a data limite.`,
            register_return: nextStatus === ORDER_STATUS.RETURNED
                ? `A devolução do pedido #${normalizedOrderId} foi concluída.`
                : `Uma devolução parcial foi registrada no pedido #${normalizedOrderId}. Ainda há unidades pendentes.`
        };
        if (messages[action]) await enqueueNotification(db, { userId: order.id_usuario,
            eventKey: `pedido:${normalizedOrderId}:${action}:${auditId}`, message: messages[action], href: '/pedidos' });

        return getOrderById(db, normalizedOrderId);
    });
}
