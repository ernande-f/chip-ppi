import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeReturnItems, normalizeReturnNotes } from '../backend/services/orderRules.js';

const items = [
    { id_produto: '1', qnt_solicitada: 5, qnt_devolvida: 2, qnt_danificada: 1 },
    { id_produto: '2', qnt_solicitada: 1, qnt_devolvida: 0, qnt_danificada: 0 }
];

test('devolução completa considera só as unidades ainda faltantes', () => {
    assert.deepEqual(normalizeReturnItems(items), [
        { id_produto: '1', quantidade: 3, danificada: 0 },
        { id_produto: '2', quantidade: 1, danificada: 0 }
    ]);
});

test('devolução parcial aceita unidades danificadas como parte das recebidas', () => {
    assert.deepEqual(normalizeReturnItems(items, [
        { productId: 1, quantity: 2, damagedQuantity: 1, expectedReturned: 2 },
        { productId: '2', quantity: 0, damagedQuantity: 0, expectedReturned: 0 }
    ]), [{ id_produto: '1', quantidade: 2, danificada: 1 }]);
});

test('impede item externo, repetido ou identificador inválido na devolução', () => {
    for (const submitted of [
        [{ productId: 3, quantity: 1, damagedQuantity: 0 }],
        [{ productId: 1, quantity: 1, damagedQuantity: 0, expectedReturned: 2 }, { productId: '1', quantity: 1, damagedQuantity: 0, expectedReturned: 2 }],
        [{ productId: true, quantity: 1, damagedQuantity: 0 }],
        [null]
    ]) assert.throws(() => normalizeReturnItems(items, submitted), /inválido ou repetido/);
});

test('impede quantidades acima do saldo, negativas, fracionadas ou danos acima do recebido', () => {
    for (const [quantity, damagedQuantity] of [[4, 0], [-1, 0], [1.5, 0], [1, -1], [1, 2], [1, 0.5], ['1', 0], [1, undefined]]) {
        assert.throws(() => normalizeReturnItems(items, [{ productId: '1', quantity, damagedQuantity }]), /Confira as quantidades/);
    }
    for (const submitted of [null, {}, [], '1']) {
        assert.throws(() => normalizeReturnItems(items, submitted), /Informe as quantidades/);
    }
    assert.throws(() => normalizeReturnItems(items, [{ productId: 1, quantity: 0, damagedQuantity: 0, expectedReturned: 2 }]), /pelo menos uma/);
    assert.throws(() => normalizeReturnItems([{ ...items[0], qnt_devolvida: 5 }]), /Informe as quantidades/);
});

test('reenvio parcial ou tela obsoleta exige recarregar sem registrar outro recebimento', () => {
    for (const expectedReturned of [undefined, -1, '2']) {
        assert.throws(() => normalizeReturnItems(items, [{ productId: 1, quantity: 1, damagedQuantity: 0, expectedReturned }]), /Recarregue o pedido/);
    }
    assert.throws(() => normalizeReturnItems(items, [{ productId: 1, quantity: 1, damagedQuantity: 0, expectedReturned: 1 }]), /já foi registrada ou o pedido mudou/);
});

test('observações de recebimento são opcionais e limitadas', () => {
    assert.equal(normalizeReturnNotes(undefined), null);
    assert.equal(normalizeReturnNotes('  '), null);
    assert.equal(normalizeReturnNotes('  Placa com pino quebrado  '), 'Placa com pino quebrado');
    assert.equal(normalizeReturnNotes('a'.repeat(1000)).length, 1000);
    for (const value of [{}, 123, 'a'.repeat(1001)]) assert.throws(() => normalizeReturnNotes(value), /até 1000/);
});
