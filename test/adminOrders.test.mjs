import assert from 'node:assert/strict';
import test from 'node:test';

const originalDocument = globalThis.document;
let selectOrders;
try {
    globalThis.document = { addEventListener() {} };
    ({ selectOrders } = await import('../frontend/js/admin-orders.js'));
} finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
}

const today = new Date(2026, 0, 3, 12);
const makeOrder = (id, status, date, name = 'Ana Silva') => ({
    id_pedido: id, status, data_pedido: date, usuario_nome: name, usuario_email: `${id}@aluno.iffar.edu.br`
});
const orders = [
    ...['Pendente', 'Aprovado', 'Em separação', 'Pronto para retirada', 'Retirado'].map((status, index) => makeOrder(index + 1, status, '2025-01-01')),
    makeOrder(6, 'Devolvido', '2026-01-03T03:00:00.000Z'),
    makeOrder(7, 'Negado', '2025-12-28'),
    makeOrder(8, 'Cancelado', '2025-12-27'),
    makeOrder(9, 'Expirado', '2024-01-01', 'Carlos')
];
const ids = orders => orders.map(order => order.id_pedido);

test('período completo preserva todos os pedidos nas etapas ativas ou no histórico', () => {
    const result = selectOrders(orders, '', 'all', 'all', today);
    assert.deepEqual(ids(result.activeOrders), [1, 2, 3, 4, 5]);
    assert.deepEqual(ids(result.historyOrders), [6, 7, 8, 9]);
    assert.equal(result.historyTotal, 4);
    assert.equal(result.activeOrders.length + result.historyOrders.length, orders.length);
});

test('data e situação do histórico nunca ocultam pedidos ativos antigos', () => {
    const result = selectOrders(orders, '', '7', 'Negado', today);
    assert.deepEqual(ids(result.activeOrders), [1, 2, 3, 4, 5]);
    assert.deepEqual(ids(result.historyOrders), [7]);
    assert.equal(result.historyTotal, 4);
});

test('últimos 7 dias incluem hoje e seis dias anteriores, atravessando o ano', () => {
    assert.deepEqual(ids(selectOrders(orders, '', '7', 'all', today).historyOrders), [6, 7]);
    assert.deepEqual(ids(selectOrders(orders, '', '1', 'all', today).historyOrders), [6]);
});

test('busca por nome, e-mail e número alcança todo o histórico, sem alterar o total', () => {
    const result = selectOrders(orders, '  CARLOS  ', 'all', 'all', today);
    assert.deepEqual(result.activeOrders, []);
    assert.deepEqual(ids(result.historyOrders), [9]);
    assert.equal(result.historyTotal, 4);
    assert.deepEqual(ids(selectOrders(orders, '7@aluno', 'all', 'all', today).historyOrders), [7]);
    assert.deepEqual(ids(selectOrders(orders, '6', 'all', 'all', today).historyOrders), [6]);
    assert.deepEqual(selectOrders(orders, 'inexistente', 'all', 'all', today).historyOrders, []);
});

test('filtro de data não inclui datas futuras ou ausentes; período completo mantém o acesso', () => {
    const unusual = [makeOrder(10, 'Cancelado', '2026-01-04'), makeOrder(11, 'Expirado', null)];
    assert.deepEqual(selectOrders(unusual, '', '30', 'all', today).historyOrders, []);
    assert.deepEqual(ids(selectOrders(unusual, '', 'all', 'all', today).historyOrders), [10, 11]);
});
