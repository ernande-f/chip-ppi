import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRenewalDate, normalizeRenewalJustification } from '../backend/services/orderRules.js';

test('renovação precisa de data futura real, posterior ao prazo e de até quinze dias adicionais', () => {
    assert.equal(validateRenewalDate('2027-01-15', '2026-12-31', '2026-12-28'), '2027-01-15');
    for (const requested of ['2026-12-31', '2027-01-16', '2027-02-30', 'amanhã', null]) {
        assert.throws(() => validateRenewalDate(requested, '2026-12-31', '2026-12-28'), /data futura/);
    }
    assert.throws(() => validateRenewalDate('2026-12-30', '2026-12-20', '2026-12-30'), /data futura/);
    assert.equal(validateRenewalDate('2028-03-01', '2028-02-29', '2028-02-28'), '2028-03-01');
});

test('renovação exige justificativa limitada e preserva o texto', () => {
    assert.equal(normalizeRenewalJustification('  Finalizar protótipo  '), 'Finalizar protótipo');
    for (const value of [null, undefined, '  ', 1, 'a'.repeat(501)]) {
        assert.throws(() => normalizeRenewalJustification(value));
    }
});
