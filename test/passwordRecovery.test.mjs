import assert from 'node:assert/strict';
import test from 'node:test';

const { getPasswordUpdateCredential } = await import('../backend/services/sessionAuth.js');

test('prioriza o token de recuperação sobre o cookie da sessão', () => {
    const credential = getPasswordUpdateCredential({
        headers: { authorization: 'Bearer recovery-token' },
        cookies: { authcookie: 'institutional-session' }
    });

    assert.deepEqual(credential, {
        token: 'recovery-token',
        kind: 'supabase-recovery'
    });
});

test('mantém o cookie para alteração de senha iniciada pelo perfil', () => {
    const credential = getPasswordUpdateCredential({
        headers: {},
        cookies: { authcookie: 'chip-session' }
    });

    assert.deepEqual(credential, {
        token: 'chip-session',
        kind: 'chip-session'
    });
});

test('rejeita um cabeçalho de autorização malformado', () => {
    const credential = getPasswordUpdateCredential({
        headers: { authorization: 'Basic invalid' },
        cookies: { authcookie: 'chip-session' }
    });

    assert.equal(credential, null);
});
