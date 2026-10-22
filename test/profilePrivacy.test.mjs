import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
const { getPublicProfile, getProfileSummaryByAuthUserId } = await import('../backend/services/userProfile.js');

test('o perfil público omite dados legados, credenciais e identificadores internos', async () => {
    const stored = {
        id_usuario: '1', nome: 'Técnico', email: 'tech@example.test', cpf: '123.456.789-09',
        nivel_acesso: 1, status_conta: true, auth_user_id: 'internal', google_sub: 'google-id',
        auth_provider: 'google', session_version: 7, senha: 'legacy', tmp_senha: 'legacy'
    };
    const original = structuredClone(stored);
    const expected = {
        id_usuario: '1', nome: 'Técnico', email: 'tech@example.test',
        nivel_acesso: 1, status_conta: true,
        motivo_bloqueio: null, bloqueio_automatico_ate: null, bloqueio_automatico_ativo: false
    };
    assert.deepEqual(getPublicProfile(stored), expected);
    assert.deepEqual(await getProfileSummaryByAuthUserId('internal', stored), {
        ...expected, nivel_acesso_label: 'Técnico', recentOrders: []
    });
    assert.deepEqual(stored, original);
});
