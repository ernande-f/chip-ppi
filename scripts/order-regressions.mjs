import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl || !['localhost', '127.0.0.1'].includes(new URL(adminUrl).hostname)) {
    throw new Error('Defina TEST_DATABASE_URL para um PostgreSQL local de testes com permissão de criar bancos.');
}
const admin = postgres(adminUrl, { max: 1, onnotice() {} });
const name = `chip_orders_${randomUUID().replaceAll('-', '')}`;
const url = new URL(adminUrl);
url.pathname = `/${name}`;
let created = false, db, locks, holder;
const pending = [];
try {
    await admin`CREATE DATABASE ${admin(name)}`;
    created = true;
    process.env.DATABASE_URL = url.href;
    db = (await import('../backend/db.js')).default;
    locks = postgres(url.href, { max: 1, onnotice() {} });
    const setup = await db.reserve();
    try {
        await setup.unsafe(await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'));
        for (const migration of ['google_login', 'reservations', 'google_only', 'indexes', 'session_version', 'pickup_deadline', 'return_conditions', 'loan_renewals', 'user_management', 'notifications', 'inventory_usage', 'remove_cpf']) {
            await setup.unsafe(await readFile(new URL(`../database/migrations/${migration}.sql`, import.meta.url), 'utf8'));
        }
    } finally { setup.release(); }
    const { upsertGoogleUserProfile } = await import('../backend/services/userProfile.js');
    const { createProduct, updateProduct } = await import('../backend/services/productService.js');
    const { addCartItem, updateCartItem, checkoutCart, transitionOrder, cancelUserOrder, expireUncollectedOrders } = await import('../backend/services/orderService.js');
    const { recordInventoryUsage } = await import('../backend/services/inventoryUsage.js');
    const { CURRENT_TERMS_VERSION } = await import('../backend/services/orderRules.js');
    const student = await upsertGoogleUserProfile({ sub: 'regression-student', email: 'regression@aluno.iffar.edu.br', name: 'Estudante Teste' });
    const tech = await upsertGoogleUserProfile({ sub: 'regression-tech', email: 'regression@iffarroupilha.edu.br', name: 'Técnico Teste' });
    const usage = id => db`SELECT disponiveis, reservadas::int, emprestadas::int, origem
        FROM historico_uso_estoque WHERE id_produto = ${id} ORDER BY id_registro`;
    const [legacy] = await db`INSERT INTO produto (nome, estoque_total, id_statusproduto)
        SELECT 'Anterior ao histórico', 0, id_statusproduto FROM status_produto WHERE status_produto = 'Indisponível' RETURNING id_produto`;
    const [legacyOrder] = await db`INSERT INTO pedido (id_usuario, id_status, data_retirada)
        SELECT ${tech.id_usuario}, id_status, current_date FROM status_pedido WHERE descricao_status = 'Retirado' RETURNING id_pedido`;
    await db`INSERT INTO contem_lista (id_pedido, id_produto, qnt_solicitada) VALUES (${legacyOrder.id_pedido}, ${legacy.id_produto}, 2)`;
    const migration = await readFile(new URL('../database/migrations/inventory_usage.sql', import.meta.url), 'utf8');
    const [beforeBaseline] = await db`SELECT clock_timestamp() AS instante`;
    const baselineSetup = await db.reserve();
    try {
        await baselineSetup.unsafe(migration);
        await baselineSetup.unsafe(migration);
    } finally { baselineSetup.release(); }
    assert.deepEqual([...await usage(legacy.id_produto)], [{ disponiveis: 0, reservadas: 0, emprestadas: 2, origem: 'inicio' }]);
    const [baseline] = await db`SELECT registrado_em FROM historico_uso_estoque WHERE id_produto = ${legacy.id_produto}`;
    assert.ok(baseline.registrado_em >= beforeBaseline.instante, 'O início do histórico observa agora e não inventa datas passadas');
    const product = await createProduct({ nome: 'Kit de testes', descricao_produto: 'Regressões de pedidos', estoque_total: 8, foto_produto: 'data:image/png;base64,AA==', categorias: ['Teste'] });
    await updateProduct(product.id_produto, { descricao_produto: 'Descrição atualizada sem alterar estoque' });
    assert.deepEqual([...await usage(product.id_produto)], [{ disponiveis: 8, reservadas: 0, emprestadas: 0, origem: 'cadastro' }]);
    const options = { durationDays: 7, acceptedTerms: true, termsVersion: CURRENT_TERMS_VERSION };
    const stock = async () => (await db`SELECT estoque_total FROM produto WHERE id_produto = ${product.id_produto}`)[0].estoque_total;
    const waitForLock = async fragment => {
        for (let attempt = 0; attempt < 200; attempt++) {
            const [row] = await admin`SELECT count(*)::int AS total FROM pg_stat_activity WHERE datname = ${name}
                AND wait_event_type = 'Lock' AND query LIKE ${`%${fragment}%`}`;
            if (row.total) return;
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.fail(`A operação não aguardou a trava esperada: ${fragment}`);
    };
    await addCartItem(student.id_usuario, product.id_produto, 3);
    for (const termsVersion of [undefined, 1, 2, String(CURRENT_TERMS_VERSION)]) {
        await assert.rejects(checkoutCart(student.id_usuario, { ...options, termsVersion }), /Recarregue a página/);
    }
    assert.equal(await stock(), 8);
    assert.equal((await db`SELECT count(*)::int AS n FROM pedido WHERE id_usuario = ${student.id_usuario}`)[0].n, 0);
    const order = await checkoutCart(student.id_usuario, options);
    assert.equal((await db`SELECT versao_termo FROM pedido WHERE id_pedido = ${order.id_pedido}`)[0].versao_termo, CURRENT_TERMS_VERSION);
    for (const action of ['approve', 'start_separation', 'mark_ready', 'confirm_pickup']) {
        await transitionOrder(tech.id_usuario, order.id_pedido, action);
    }
    const full = await transitionOrder(tech.id_usuario, order.id_pedido, 'register_return');
    assert.equal(full.status, 'Devolvido');
    assert.notEqual(full.data_devolucao, null);
    assert.equal(full.itens[0].qnt_devolvida, 3);
    assert.equal(await stock(), 8);
    const audits = await db`SELECT dados_anteriores, dados_posteriores FROM log_auditoria WHERE acao = 'pedido:register_return' ORDER BY id_log`;
    assert.equal(audits.length, 1);
    assert.equal(JSON.parse(audits[0].dados_anteriores).status, 'Retirado');
    assert.equal(JSON.parse(audits[0].dados_posteriores).status, 'Devolvido');
    await assert.rejects(transitionOrder(tech.id_usuario, order.id_pedido, 'register_return'), /não permitida/);
    assert.equal(await stock(), 8);
    assert.deepEqual([...await usage(product.id_produto)], [
        { disponiveis: 8, reservadas: 0, emprestadas: 0, origem: 'cadastro' },
        { disponiveis: 5, reservadas: 3, emprestadas: 0, origem: 'pedido:checkout' },
        { disponiveis: 5, reservadas: 0, emprestadas: 3, origem: 'pedido:confirm_pickup' },
        { disponiveis: 8, reservadas: 0, emprestadas: 0, origem: 'pedido:register_return' }
    ], 'Aprovação/separação não duplicam snapshots e reserva não é empréstimo');

    // A edição começa primeiro e segura a trava do usuário enquanto aguarda o produto.
    await addCartItem(student.id_usuario, product.id_produto, 1);
    holder = await locks.reserve();
    await holder`BEGIN`;
    await holder`SELECT id_produto FROM produto WHERE id_produto = ${product.id_produto} FOR UPDATE`;
    const edit = updateCartItem(student.id_usuario, product.id_produto, 2);
    pending.push(edit);
    await waitForLock('SELECT produto.estoque_total');
    const checkout = checkoutCart(student.id_usuario, options);
    pending.push(checkout);
    await waitForLock('SELECT id_usuario, status_conta');
    await holder`COMMIT`;
    holder.release(); holder = null;
    assert.equal((await edit).quantidade, 2);
    const concurrentOrder = await checkout;
    assert.equal(concurrentOrder.itens[0].qnt_solicitada, 2);
    assert.equal((await db`SELECT count(*)::int AS n FROM lista_de_desejos WHERE id_usuario = ${student.id_usuario}`)[0].n, 0);

    // Se o checkout começa primeiro, a edição posterior deve falhar, nunca confirmar uma mudança perdida.
    await addCartItem(student.id_usuario, product.id_produto, 1);
    holder = await locks.reserve();
    await holder`BEGIN`;
    await holder`SELECT id_produto FROM produto WHERE id_produto = ${product.id_produto} FOR UPDATE`;
    const checkoutFirst = checkoutCart(student.id_usuario, options);
    pending.push(checkoutFirst);
    await waitForLock('FOR UPDATE OF produto');
    const editAfter = updateCartItem(student.id_usuario, product.id_produto, 2);
    pending.push(editAfter);
    const editRejected = assert.rejects(editAfter, /Item não encontrado no carrinho/);
    await waitForLock('SELECT id_usuario, status_conta');
    await holder`COMMIT`;
    holder.release(); holder = null;
    assert.equal((await checkoutFirst).itens[0].qnt_solicitada, 1);
    await editRejected;

    const archived = await createProduct({ nome: 'Item arquivado', descricao_produto: 'Devolução preserva arquivamento', estoque_total: 1, foto_produto: 'data:image/png;base64,AA==', categorias: ['Teste'] });
    await addCartItem(student.id_usuario, archived.id_produto, 1);
    const archivedOrder = await checkoutCart(student.id_usuario, options);
    for (const action of ['approve', 'start_separation', 'mark_ready', 'confirm_pickup']) {
        await transitionOrder(tech.id_usuario, archivedOrder.id_pedido, action);
    }
    await db`UPDATE produto SET id_statusproduto = (SELECT id_statusproduto FROM status_produto WHERE status_produto = 'Arquivado' LIMIT 1) WHERE id_produto = ${archived.id_produto}`;
    await transitionOrder(tech.id_usuario, archivedOrder.id_pedido, 'register_return');
    const [restoredArchive] = await db`SELECT estoque_total, status_produto FROM produto JOIN status_produto USING (id_statusproduto) WHERE id_produto = ${archived.id_produto}`;
    assert.equal(restoredArchive.estoque_total, 1);
    assert.equal(restoredArchive.status_produto, 'Arquivado');
    const partialProduct = await createProduct({ nome: 'Kit parcial', descricao_produto: 'Conferência de unidades com danos', estoque_total: 5, foto_produto: 'data:image/png;base64,AA==', categorias: ['Teste'] });
    await addCartItem(student.id_usuario, partialProduct.id_produto, 4);
    await addCartItem(student.id_usuario, product.id_produto, 1);
    const partialOrder = await checkoutCart(student.id_usuario, options);
    for (const action of ['approve', 'start_separation', 'mark_ready', 'confirm_pickup']) await transitionOrder(tech.id_usuario, partialOrder.id_pedido, action);
    const partialStock = async () => (await db`SELECT estoque_total FROM produto WHERE id_produto = ${partialProduct.id_produto}`)[0].estoque_total;
    const receive = (quantity, damagedQuantity, expectedReturned) => ({ productId: partialProduct.id_produto, quantity, damagedQuantity, expectedReturned });
    await assert.rejects(transitionOrder(tech.id_usuario, partialOrder.id_pedido, 'register_return', {
        returnItems: [receive(1, 0, 0), { productId: product.id_produto, quantity: 2, damagedQuantity: 0, expectedReturned: 0 }]
    }), /Confira as quantidades/);
    assert.equal(await partialStock(), 1);
    const partial = await transitionOrder(tech.id_usuario, partialOrder.id_pedido, 'register_return', {
        returnItems: [receive(1, 1, 0)], returnNotes: 'Unidade com pino quebrado', ip: '127.0.0.1'
    });
    assert.equal(partial.status, 'Retirado');
    assert.equal(partial.data_devolucao, null);
    assert.equal(partial.itens.find(item => String(item.id_produto) === String(partialProduct.id_produto)).qnt_danificada, 1);
    assert.equal(partial.devolucoes[0].observacao, 'Unidade com pino quebrado');
    assert.equal(await partialStock(), 1, 'Receber apenas danificadas não libera estoque');
    await assert.rejects(transitionOrder(tech.id_usuario, partialOrder.id_pedido, 'register_return', {
        returnItems: [receive(1, 1, 0)]
    }), /já foi registrada ou o pedido mudou/);
    const simultaneous = await Promise.allSettled([1, 2].map(() => transitionOrder(tech.id_usuario, partialOrder.id_pedido, 'register_return', {
        returnItems: [receive(1, 0, 1)]
    })));
    assert.equal(simultaneous.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(simultaneous.find(result => result.status === 'rejected').reason.message, /já foi registrada ou o pedido mudou/);
    assert.equal(await partialStock(), 2, 'Reenvio concorrente repõe uma única unidade');
    const completed = await transitionOrder(tech.id_usuario, partialOrder.id_pedido, 'register_return', {
        returnItems: [receive(2, 1, 2), { productId: product.id_produto, quantity: 1, damagedQuantity: 0, expectedReturned: 0 }]
    });
    assert.equal(completed.status, 'Devolvido');
    assert.ok(completed.data_devolucao);
    assert.equal(await partialStock(), 3, 'Duas unidades danificadas permanecem fora do estoque');
    assert.equal(completed.devolucoes.length, 3);
    const [partialAudit] = await db`SELECT dados_anteriores, dados_posteriores, ip FROM log_auditoria
        WHERE acao = 'pedido:register_return' AND dados_posteriores::jsonb ->> 'id_pedido' = ${String(partialOrder.id_pedido)} ORDER BY id_log`;
    assert.equal(JSON.parse(partialAudit.dados_anteriores).itens.find(item => item.id_produto === partialProduct.id_produto).qnt_devolvida, 0);
    assert.equal(JSON.parse(partialAudit.dados_posteriores).devolucao[0].danificada, 1);
    assert.equal(partialAudit.ip, '127.0.0.1');
    assert.deepEqual([...await usage(partialProduct.id_produto)], [
        { disponiveis: 5, reservadas: 0, emprestadas: 0, origem: 'cadastro' },
        { disponiveis: 1, reservadas: 4, emprestadas: 0, origem: 'pedido:checkout' },
        { disponiveis: 1, reservadas: 0, emprestadas: 4, origem: 'pedido:confirm_pickup' },
        { disponiveis: 1, reservadas: 0, emprestadas: 3, origem: 'pedido:register_return' },
        { disponiveis: 2, reservadas: 0, emprestadas: 2, origem: 'pedido:register_return' },
        { disponiveis: 3, reservadas: 0, emprestadas: 0, origem: 'pedido:register_return' }
    ], 'Danificadas saem do empréstimo sem somar ao disponível e reenvios não gravam histórico');

    const capacity = await createProduct({ nome: 'Kit de capacidade', descricao_produto: 'Histórico de empréstimo de toda a capacidade', estoque_total: 2, foto_produto: 'data:image/png;base64,AA==', categorias: ['Teste'] });
    await addCartItem(student.id_usuario, capacity.id_produto, 2);
    const capacityOrder = await checkoutCart(student.id_usuario, options);
    for (const action of ['approve', 'start_separation', 'mark_ready', 'confirm_pickup']) await transitionOrder(tech.id_usuario, capacityOrder.id_pedido, action);
    await transitionOrder(tech.id_usuario, capacityOrder.id_pedido, 'register_return', {
        returnItems: [{ productId: capacity.id_produto, quantity: 1, damagedQuantity: 1, expectedReturned: 0 }]
    });
    assert.deepEqual((await usage(capacity.id_produto)).slice(-2).map(row => [row.disponiveis, row.reservadas, row.emprestadas]), [[0, 0, 2], [0, 0, 1]], 'Danos podem manter o estoque totalmente emprestado, sem criar nova entrada');
    await updateProduct(capacity.id_produto, { estoque_total: 2 });
    await updateProduct(capacity.id_produto, { estoque_total: 0 });
    const beforeArchive = [...await usage(capacity.id_produto)];
    await updateProduct(capacity.id_produto, { archived: true });
    await updateProduct(capacity.id_produto, { archived: false });
    await db.begin(tx => recordInventoryUsage(tx, [capacity.id_produto], 'repetido'));
    assert.deepEqual([...await usage(capacity.id_produto)], beforeArchive, 'Arquivamento e observações iguais não duplicam números');
    await assert.rejects(db.begin(async tx => {
        await tx`UPDATE produto SET estoque_total = 9 WHERE id_produto = ${capacity.id_produto}`;
        await recordInventoryUsage(tx, [capacity.id_produto], 'rollback');
        throw new Error('Desfazer teste');
    }), /Desfazer teste/);
    assert.deepEqual([...await usage(capacity.id_produto)], beforeArchive, 'Snapshot pertence à transação da alteração');
    await transitionOrder(tech.id_usuario, capacityOrder.id_pedido, 'register_return');
    for (const ending of ['cancel', 'deny', 'expire']) {
        await addCartItem(student.id_usuario, capacity.id_produto, 1);
        const endingOrder = await checkoutCart(student.id_usuario, options);
        if (ending === 'cancel') await cancelUserOrder(student.id_usuario, endingOrder.id_pedido);
        else if (ending === 'deny') await transitionOrder(tech.id_usuario, endingOrder.id_pedido, 'deny', { reason: 'Teste de liberação de reserva' });
        else {
            await transitionOrder(tech.id_usuario, endingOrder.id_pedido, 'approve');
            await db`UPDATE pedido SET data_aprovacao = current_date - 11 WHERE id_pedido = ${endingOrder.id_pedido}`;
            await expireUncollectedOrders();
        }
        assert.deepEqual((await usage(capacity.id_produto)).at(-1), { disponiveis: 1, reservadas: 0, emprestadas: 0, origem: `pedido:${ending}` });
    }

    const shared = await createProduct({ nome: 'Kit compartilhado', descricao_produto: 'Concorrência de registro do uso de estoque', estoque_total: 3, foto_produto: 'data:image/png;base64,AA==', categorias: ['Teste'] });
    await Promise.all([student, tech].map(user => addCartItem(user.id_usuario, shared.id_produto, 1)));
    const concurrent = await Promise.all([student, tech].map(user => checkoutCart(user.id_usuario, options)));
    for (const action of ['approve', 'start_separation', 'mark_ready', 'confirm_pickup', 'register_return']) {
        await Promise.all(concurrent.map(row => transitionOrder(tech.id_usuario, row.id_pedido, action)));
    }
    assert.deepEqual((await usage(shared.id_produto)).map(row => [row.disponiveis, row.reservadas, row.emprestadas]), [
        [3, 0, 0], [2, 1, 0], [1, 2, 0], [1, 1, 1], [1, 0, 2], [2, 0, 1], [3, 0, 0]
    ], 'Checkouts/retiradas/devoluções concorrentes mantêm cada transição real de estoque');
    console.log('OK: termo versionado, devoluções parciais/danos/auditoria/arquivamento, proteção contra reenvio, concorrência real e histórico de estoque transacional/idempotente sem datas inventadas.');
} finally {
    if (holder) { await holder`ROLLBACK`; holder.release(); }
    await Promise.allSettled(pending);
    if (db) await db.end({ timeout: 2 });
    if (locks) await locks.end({ timeout: 2 });
    if (created) await admin`DROP DATABASE ${admin(name)}`;
    await admin.end();
}
