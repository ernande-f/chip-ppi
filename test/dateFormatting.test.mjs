import assert from 'node:assert/strict';
import test from 'node:test';

const { formatDate } = await import('../frontend/js/api.js');

test('formata datas do PostgreSQL serializadas como ISO', () => {
    assert.equal(formatDate('2026-08-04T00:00:00.000Z'), '04/08/2026');
});

test('mantém suporte a datas no formato YYYY-MM-DD', () => {
    assert.equal(formatDate('2026-08-04'), '04/08/2026');
});

test('uma data inválida não interrompe a renderização', () => {
    assert.equal(formatDate('valor-inválido'), 'Data inválida');
    assert.equal(formatDate(null), 'Não informado');
});
