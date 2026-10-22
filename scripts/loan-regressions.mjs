import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl || !['localhost', '127.0.0.1'].includes(new URL(adminUrl).hostname)) {
    throw new Error('Defina TEST_DATABASE_URL para um PostgreSQL local de testes com permissão de criar bancos.');
}
process.env.NOTIFICATION_EMAIL_ENABLED = 'false';
const admin = postgres(adminUrl, { max: 1, onnotice() {} });
const name = `chip_loans_${randomUUID().replaceAll('-', '')}`;
const url = new URL(adminUrl);
url.pathname = `/${name}`;
let created = false, db;
try {
    await admin`CREATE DATABASE ${admin(name)}`;
    created = true;
    process.env.DATABASE_URL = url.href;
    db = (await import('../backend/db.js')).default;
    const setup = await db.reserve();
    try {
        await setup.unsafe(await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'));
        for (const migration of ['google_login', 'reservations', 'google_only', 'indexes', 'session_version', 'pickup_deadline', 'return_conditions', 'loan_renewals', 'user_management', 'notifications', 'inventory_usage']) {
            await setup.unsafe(await readFile(new URL(`../database/migrations/${migration}.sql`, import.meta.url), 'utf8'));
        }
    } finally { setup.release(); }
    const { upsertGoogleUserProfile } = await import('../backend/services/userProfile.js');
    const { createProduct } = await import('../backend/services/productService.js');
    const { addCartItem, checkoutCart, transitionOrder, listUserOrders, requestOrderRenewal, decideOrderRenewal, repeatOrder } = await import('../backend/services/orderService.js');
    const { CURRENT_TERMS_VERSION } = await import('../backend/services/orderRules.js');
    const student = await upsertGoogleUserProfile({ sub: 'loans-student', email: 'loans@aluno.iffar.edu.br', name: 'Estudante Teste' });
    const stranger = await upsertGoogleUserProfile({ sub: 'loans-stranger', email: 'stranger@aluno.iffar.edu.br', name: 'Outra Pessoa' });
    const tech = await upsertGoogleUserProfile({ sub: 'loans-tech', email: 'loans@iffarroupilha.edu.br', name: 'Técnico Teste' });
    await db`UPDATE usuario SET nivel_acesso = 1 WHERE id_usuario = ${tech.id_usuario}`;
    const product = await createProduct({ nome: 'Kit renovação', descricao_produto: 'Regressões de empréstimos', estoque_total: 20, foto_produto: 'data:image/png;base64,AA==', categorias: ['Teste'] });
    const archived = await createProduct({ nome: 'Kit arquivado', descricao_produto: 'Produto que será arquivado', estoque_total: 2, foto_produto: 'data:image/png;base64,AA==', categorias: ['Teste'] });
    const missing = await createProduct({ nome: 'Kit sem estoque', descricao_produto: 'Produto sem estoque depois', estoque_total: 3, foto_produto: 'data:image/png;base64,AA==', categorias: ['Teste'] });
    await addCartItem(student.id_usuario, product.id_produto, 4);
    await addCartItem(student.id_usuario, archived.id_produto, 1);
    await addCartItem(student.id_usuario, missing.id_produto, 2);
    const order = await checkoutCart(student.id_usuario, { durationDays: 7, acceptedTerms: true, termsVersion: CURRENT_TERMS_VERSION });
    const shifted = (date, days) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
    const fresh = async () => (await listUserOrders(student.id_usuario)).find(item => item.id_pedido === order.id_pedido);
    await assert.rejects(requestOrderRenewal(student.id_usuario, order.id_pedido, { requestedDate: '2030-01-01', justification: 'Teste' }), /Somente pedidos retirados/);
    for (const action of ['approve', 'start_separation', 'mark_ready', 'confirm_pickup']) await transitionOrder(tech.id_usuario, order.id_pedido, action);
    const picked = await fresh();
    const originalDue = picked.data_prevista_devolucao;
    const request = { requestedDate: shifted(originalDue, 3), justification: 'Concluir o protótipo da disciplina' };
    await assert.rejects(requestOrderRenewal(stranger.id_usuario, order.id_pedido, request), /não encontrado/);
    await assert.rejects(requestOrderRenewal(student.id_usuario, order.id_pedido, { ...request, justification: ' ' }), /justificativa/);
    await assert.rejects(requestOrderRenewal(student.id_usuario, order.id_pedido, { ...request, requestedDate: shifted(originalDue, 16) }), /data futura/);
    const requests = await Promise.allSettled([1, 2].map(() => requestOrderRenewal(student.id_usuario, order.id_pedido, request)));
    assert.equal(requests.filter(result => result.status === 'fulfilled').length, 1, 'Apenas uma renovação pendente mesmo sob concorrência');
    const pending = await fresh();
    assert.equal(pending.data_prevista_devolucao, originalDue, 'Solicitação não muda o prazo');
    assert.equal(pending.renovacoes.length, 1);
    await assert.rejects(decideOrderRenewal(tech.id_usuario, order.id_pedido, pending.renovacoes[0].id_renovacao, { approved: false, reason: '' }), /justificativa/);
    const denied = await decideOrderRenewal(tech.id_usuario, order.id_pedido, pending.renovacoes[0].id_renovacao, { approved: false, reason: 'Equipamento reservado para aula' });
    assert.equal(denied.data_prevista_devolucao, originalDue);
    assert.equal(denied.renovacoes[0].status, 'Negada');
    for (let approvedCount = 1; approvedCount <= 2; approvedCount++) {
        const current = await fresh();
        const requestedDate = shifted(current.data_prevista_devolucao, 3);
        const requested = await requestOrderRenewal(student.id_usuario, order.id_pedido, { ...request, requestedDate });
        const renewal = requested.renovacoes.at(-1);
        const decisions = await Promise.allSettled([1, 2].map(() => decideOrderRenewal(tech.id_usuario, order.id_pedido, renewal.id_renovacao, { approved: true })));
        assert.equal(decisions.filter(result => result.status === 'fulfilled').length, 1, 'Decisão duplicada só aplica uma vez');
        const approved = await fresh();
        assert.equal(approved.data_prevista_devolucao, requestedDate);
        assert.equal(approved.renovacoes.filter(item => item.status === 'Aprovada').length, approvedCount);
        assert.equal(approved.duracao_dias, 7, 'Renovação preserva duração original');
        assert.equal(String(approved.data_retirada), String(picked.data_retirada));
        assert.equal(String(approved.data_limite_retirada), String(picked.data_limite_retirada), 'Renovação preserva janela de dez dias para retirada');
    }
    await assert.rejects(requestOrderRenewal(student.id_usuario, order.id_pedido, { ...request, requestedDate: shifted((await fresh()).data_prevista_devolucao, 1) }), /duas renovações/);
    await assert.rejects(repeatOrder(stranger.id_usuario, order.id_pedido), /não encontrado/);
    await addCartItem(student.id_usuario, product.id_produto, 1);
    await db`UPDATE produto SET estoque_total = 3 WHERE id_produto = ${product.id_produto}`;
    await db`UPDATE produto SET id_statusproduto = (SELECT id_statusproduto FROM status_produto WHERE status_produto = 'Arquivado') WHERE id_produto = ${archived.id_produto}`;
    await db`UPDATE produto SET estoque_total = 0, id_statusproduto = (SELECT id_statusproduto FROM status_produto WHERE status_produto = 'Indisponível') WHERE id_produto = ${missing.id_produto}`;
    const copied = await repeatOrder(student.id_usuario, order.id_pedido);
    assert.equal(copied.addedQuantity, 2);
    assert.equal(copied.warnings.length, 3);
    assert.match(copied.warnings.join(' '), /arquivado/);
    assert.match(copied.warnings.join(' '), /sem estoque/);
    assert.equal((await db`SELECT quantidade FROM lista_de_desejos WHERE id_usuario = ${student.id_usuario}`)[0].quantidade, 3);
    assert.equal((await db`SELECT count(*)::int AS n FROM pedido`)[0].n, 1, 'Pedir novamente não envia nem aceita termo de novo pedido');
    await db`UPDATE produto SET estoque_total = 10 WHERE id_produto = ${product.id_produto}`;
    await Promise.all([1, 2].map(() => repeatOrder(student.id_usuario, order.id_pedido)));
    assert.equal((await db`SELECT quantidade FROM lista_de_desejos WHERE id_usuario = ${student.id_usuario}`)[0].quantidade, 10, 'Cópias concorrentes somam sem ultrapassar estoque');
    const [{ n: staffNotifications }] = await db`SELECT count(*)::int AS n FROM notificar WHERE id_usuario = ${tech.id_usuario}`;
    assert.equal(staffNotifications, 3);
    const [{ n: decisionAudits }] = await db`SELECT count(*)::int AS n FROM log_auditoria WHERE acao IN ('pedido:approve_renewal','pedido:deny_renewal')`;
    assert.equal(decisionAudits, 3);
    await db`UPDATE pedido SET data_retirada = current_date - 20 WHERE id_pedido = ${order.id_pedido}`;
    await db`UPDATE renovacao SET data_estendida = current_date - 2 WHERE status = 'Aprovada'`;
    const partial = await transitionOrder(tech.id_usuario, order.id_pedido, 'register_return', {
        returnItems: [{ productId: product.id_produto, quantity: 1, damagedQuantity: 0, expectedReturned: 0 }]
    });
    assert.equal(partial.status, 'Retirado');
    assert.equal((await db`SELECT count(*)::int AS n FROM penalidade_atraso`)[0].n, 0);
    const returned = await transitionOrder(tech.id_usuario, order.id_pedido, 'register_return');
    assert.equal(returned.status, 'Devolvido');
    const [penalty] = await db`SELECT dias_bloqueio, data_prevista::text FROM penalidade_atraso WHERE id_pedido = ${order.id_pedido}`;
    assert.equal(penalty.dias_bloqueio, 2, 'Penalidade considera prazo renovado, não o original');
    assert.equal(penalty.data_prevista, returned.data_prevista_devolucao);
    await assert.rejects(addCartItem(student.id_usuario, product.id_produto, 1), /bloquead/);
    await addCartItem(stranger.id_usuario, product.id_produto, 1);
    const racingOrder = await checkoutCart(stranger.id_usuario, { durationDays: 7, acceptedTerms: true, termsVersion: CURRENT_TERMS_VERSION });
    for (const action of ['approve', 'start_separation', 'mark_ready', 'confirm_pickup']) await transitionOrder(tech.id_usuario, racingOrder.id_pedido, action);
    const [racingPicked] = await listUserOrders(stranger.id_usuario);
    const racingRequest = await requestOrderRenewal(stranger.id_usuario, racingOrder.id_pedido,
        { requestedDate: shifted(racingPicked.data_prevista_devolucao, 1), justification: 'Teste de decisão e recebimento simultâneos' });
    const racingResults = await Promise.allSettled([
        decideOrderRenewal(tech.id_usuario, racingOrder.id_pedido, racingRequest.renovacoes[0].id_renovacao, { approved: true }),
        transitionOrder(tech.id_usuario, racingOrder.id_pedido, 'register_return')
    ]);
    assert.equal(racingResults[1].status, 'fulfilled', 'Devolução concorrente com decisão deve concluir sem deadlock');
    if (racingResults[0].status === 'rejected') assert.match(racingResults[0].reason.message, /Somente pedidos retirados/);
    const [racingReturned] = await listUserOrders(stranger.id_usuario);
    assert.equal(racingReturned.status, 'Devolvido');
    assert.equal(racingReturned.renovacoes.some(item => item.status === 'Pendente'), false);
    console.log('OK: renovação com justificativa/data/limites/autoria/auditoria/notificações e concorrência, prazo efetivo na penalidade, repetição segura de pedidos no carrinho.');
} finally {
    if (db) await db.end({ timeout: 2 });
    if (created) await admin`DROP DATABASE ${admin(name)}`;
    await admin.end();
}
