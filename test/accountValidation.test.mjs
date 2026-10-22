import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountAccessError, assertAccountIsActive } from '../backend/services/accountValidation.js';

test('recusa contas inexistentes ou bloqueadas', () => {
    assert.doesNotThrow(() => assertAccountIsActive({ status_conta: true }));
    assert.throws(() => assertAccountIsActive({ status_conta: false }), AccountAccessError);
    assert.throws(() => assertAccountIsActive({ status_conta: true, bloqueio_automatico_ativo: true }), AccountAccessError);
    assert.doesNotThrow(() => assertAccountIsActive({ status_conta: true, bloqueio_automatico_ativo: false }));
    assert.throws(() => assertAccountIsActive(null), AccountAccessError);
});
