import sql from '../db.js';
import {
    ORDER_ACTION,
    ORDER_STATUS,
    OrderValidationError,
    getNextOrderStatus,
    normalizeCartQuantity,
    normalizeLoanDuration,
    normalizeOrderJustification,
    validateTransitionReason
} from './orderRules.js';

export class OrderNotFoundError extends Error {}
export class OrderConflictError extends Error {}

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
                estoque_total = estoque_total + ${item.qnt_solicitada},
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
            pedido.data_retirada,
            pedido.data_devolucao,
            CASE
                WHEN pedido.data_retirada IS NOT NULL
                THEN pedido.data_retirada + pedido.duracao_dias
                ELSE NULL
            END AS data_prevista_devolucao,
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
            ) AS itens
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

export async function addCartItem(userId, productId, quantity = 1) {
    const normalizedUserId = normalizeId(userId, 'Usuário');
    const normalizedProductId = normalizeId(productId, 'Item');

    return sql.begin(async (db) => {
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
    const [item] = await sql`
        DELETE FROM lista_de_desejos
        WHERE id_usuario = ${normalizedUserId}
          AND id_produto = ${normalizedProductId}
        RETURNING id_produto
    `;

    if (!item) {
        throw new OrderNotFoundError('Item não encontrado no carrinho.');
    }

    return item;
}

export async function checkoutCart(userId, { durationDays, acceptedTerms, justification }) {
    const normalizedUserId = normalizeId(userId, 'Usuário');
    const duration = normalizeLoanDuration(durationDays);
    const normalizedJustification = normalizeOrderJustification(justification);

    if (acceptedTerms !== true) {
        throw new OrderValidationError('É necessário aceitar o termo de responsabilidade.');
    }

    return sql.begin(async (db) => {
        await db`
            SELECT id_usuario
            FROM usuario
            WHERE id_usuario = ${normalizedUserId}
            FOR UPDATE
        `;

        const [activeOrders] = await db`
            SELECT count(*)::int AS total
            FROM pedido
            INNER JOIN status_pedido ON status_pedido.id_status = pedido.id_status
            WHERE pedido.id_usuario = ${normalizedUserId}
              AND lower(status_pedido.descricao_status) NOT IN ('devolvido', 'negado', 'cancelado')
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
                1,
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
        return getOrderById(db, order.id_pedido);
    });
}

export async function listUserOrders(userId) {
    const normalizedUserId = normalizeId(userId, 'Usuário');
    return queryOrders(sql, { userId: normalizedUserId });
}

export async function cancelUserOrder(userId, orderId, { ip } = {}) {
    const normalizedUserId = normalizeId(userId, 'Usuário');
    const normalizedOrderId = normalizeId(orderId, 'Pedido');

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

        await restoreOrderItemsStock(db, normalizedOrderId);

        await db`
            UPDATE pedido
            SET id_status = ${nextStatusId}
            WHERE id_pedido = ${normalizedOrderId}
        `;
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
    return queryOrders(sql, { status: normalizedStatus });
}

async function recordOrderAudit(db, {
    actorUserId,
    orderId,
    action,
    previousStatus,
    nextStatus,
    ip
}) {
    await db`
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
            ${JSON.stringify({ id_pedido: orderId, status: previousStatus })},
            ${JSON.stringify({ id_pedido: orderId, status: nextStatus })},
            ${ip || null},
            ${actorUserId}
        )
    `;
}

export async function transitionOrder(actorUserId, orderId, action, { reason, ip } = {}) {
    const normalizedActorUserId = normalizeId(actorUserId, 'Usuário');
    const normalizedOrderId = normalizeId(orderId, 'Pedido');
    const normalizedReason = validateTransitionReason(action, reason);

    return sql.begin(async (db) => {
        const [order] = await db`
            SELECT
                pedido.id_pedido,
                pedido.id_status,
                pedido.duracao_dias,
                status_pedido.descricao_status AS status
            FROM pedido
            INNER JOIN status_pedido ON status_pedido.id_status = pedido.id_status
            WHERE pedido.id_pedido = ${normalizedOrderId}
            FOR UPDATE OF pedido
        `;

        if (!order) {
            throw new OrderNotFoundError('Pedido não encontrado.');
        }

        const nextStatus = getNextOrderStatus(order.status, action);
        const nextStatusId = await getOrderStatusId(db, nextStatus);

        if (action === ORDER_ACTION.DENY || action === ORDER_ACTION.CANCEL) {
            await restoreOrderItemsStock(db, normalizedOrderId);
        }

        if (action === ORDER_ACTION.REGISTER_RETURN) {
            await restoreOrderItemsStock(db, normalizedOrderId);

            await db`
                UPDATE contem_lista
                SET qnt_devolvida = qnt_solicitada, status_item = 'Devolvido'
                WHERE id_pedido = ${normalizedOrderId}
            `;

            await db`
                UPDATE pedido
                SET
                    id_status = ${nextStatusId},
                    motivo_recusa = ${normalizedReason},
                    data_devolucao = current_date
                WHERE id_pedido = ${normalizedOrderId}
            `;
        } else if (action === ORDER_ACTION.CONFIRM_PICKUP) {
            await db`
                UPDATE pedido
                SET
                    id_status = ${nextStatusId},
                    motivo_recusa = ${normalizedReason},
                    data_retirada = current_date,
                    data_devolucao = NULL
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
        await recordOrderAudit(db, {
            actorUserId: normalizedActorUserId,
            orderId: normalizedOrderId,
            action,
            previousStatus: order.status,
            nextStatus,
            ip
        });

        return getOrderById(db, normalizedOrderId);
    });
}
