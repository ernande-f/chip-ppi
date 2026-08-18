import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ORDER_ACTION,
    ORDER_STATUS,
    getNextOrderStatus,
    normalizeCartQuantity,
    normalizeLoanDuration,
    normalizeOrderJustification,
    validateTransitionReason
} from '../backend/services/orderRules.js';

test('aceita empréstimos de um a quinze dias', () => {
    assert.equal(normalizeLoanDuration('1'), 1);
    assert.equal(normalizeLoanDuration(15), 15);
    assert.throws(() => normalizeLoanDuration(0), /entre 1 e 15 dias/);
    assert.throws(() => normalizeLoanDuration(16), /entre 1 e 15 dias/);
    assert.throws(() => normalizeLoanDuration('abc'), /entre 1 e 15 dias/);
});

test('mantém as transições do fluxo de pedidos explícitas', () => {
    assert.equal(getNextOrderStatus(ORDER_STATUS.PENDING, ORDER_ACTION.APPROVE), ORDER_STATUS.APPROVED);
    assert.equal(getNextOrderStatus(ORDER_STATUS.APPROVED, ORDER_ACTION.START_SEPARATION), ORDER_STATUS.SEPARATING);
    assert.equal(getNextOrderStatus(ORDER_STATUS.SEPARATING, ORDER_ACTION.MARK_READY), ORDER_STATUS.READY);
    assert.equal(getNextOrderStatus(ORDER_STATUS.READY, ORDER_ACTION.CONFIRM_PICKUP), ORDER_STATUS.PICKED_UP);
    assert.equal(getNextOrderStatus(ORDER_STATUS.PICKED_UP, ORDER_ACTION.REGISTER_RETURN), ORDER_STATUS.RETURNED);
});

test('nega transições fora de ordem', () => {
    assert.throws(
        () => getNextOrderStatus(ORDER_STATUS.PENDING, ORDER_ACTION.MARK_READY),
        /não permitida/
    );
    assert.throws(
        () => getNextOrderStatus(ORDER_STATUS.RETURNED, ORDER_ACTION.APPROVE),
        /não permitida/
    );
});

test('permite negar ou cancelar somente um pedido pendente', () => {
    assert.equal(getNextOrderStatus(ORDER_STATUS.PENDING, ORDER_ACTION.DENY), ORDER_STATUS.DENIED);
    assert.equal(getNextOrderStatus(ORDER_STATUS.PENDING, ORDER_ACTION.CANCEL), ORDER_STATUS.CANCELLED);
    assert.throws(
        () => getNextOrderStatus(ORDER_STATUS.APPROVED, ORDER_ACTION.CANCEL),
        /não permitida/
    );
});

test('valida a quantidade do carrinho contra o estoque disponível', () => {
    assert.equal(normalizeCartQuantity('2', 5), 2);
    assert.throws(() => normalizeCartQuantity(0, 5), /quantidade válida/);
    assert.throws(() => normalizeCartQuantity(-1, 5), /quantidade válida/);
    assert.throws(() => normalizeCartQuantity(6, 5), /estoque disponível/);
});

test('exige justificativa ao negar um pedido', () => {
    assert.equal(validateTransitionReason(ORDER_ACTION.DENY, 'Item indisponível'), 'Item indisponível');
    assert.equal(validateTransitionReason(ORDER_ACTION.APPROVE, ''), null);
    assert.throws(() => validateTransitionReason(ORDER_ACTION.DENY, '  '), /justificativa/);
});

test('normaliza o motivo opcional do pedido', () => {
    assert.equal(normalizeOrderJustification(null), null);
    assert.equal(normalizeOrderJustification(undefined), null);
    assert.equal(normalizeOrderJustification('   '), null);
    assert.equal(normalizeOrderJustification('  Projeto de robótica  '), 'Projeto de robótica');
    assert.throws(() => normalizeOrderJustification(123), /texto válido/);
    assert.throws(() => normalizeOrderJustification('a'.repeat(501)), /máximo 500 caracteres/);
});

