import assert from 'node:assert/strict';
import test from 'node:test';

process.env.APP_SESSION_SECRET = 'test-session-secret-with-enough-length';

const { authenticateInstitutional } = await import('../backend/services/institutionalAuth.js');
const { createSessionToken, verifySessionToken } = await import('../backend/services/sessionAuth.js');

test('envia CPF, senha e tipo no formato exigido pelo IFFar', async () => {
    let request;

    const result = await authenticateInstitutional(
        { cpf: '123.456.789-09', password: 'senha-de-teste', type: 'l' },
        async (url, options) => {
            request = { url, options };
            return new Response(JSON.stringify({ status: 'success', nome: 'Pessoa Teste' }), {
                headers: { 'content-type': 'application/json' }
            });
        }
    );

    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.body.get('user'), '12345678909');
    assert.equal(request.options.body.get('pass'), 'senha-de-teste');
    assert.equal(request.options.body.get('tipo'), 'L');
    assert.deepEqual(result, {
        cpf: '12345678909',
        type: 'L',
        name: 'Pessoa Teste',
        email: null
    });
});

test('não autentica quando o IFFar retorna status fail', async () => {
    const result = await authenticateInstitutional(
        { cpf: '12345678909', password: 'senha-de-teste', type: 'S' },
        async () => new Response(JSON.stringify({ status: 'fail' }), {
            headers: { 'content-type': 'application/json' }
        })
    );

    assert.equal(result, null);
});

test('valida CPF e tipo antes de chamar o serviço institucional', async () => {
    let requestWasMade = false;

    await assert.rejects(
        () => authenticateInstitutional(
            { cpf: '123', password: 'senha-de-teste', type: 'X' },
            async () => {
                requestWasMade = true;
                return new Response();
            }
        ),
        /Informe um CPF válido/
    );

    assert.equal(requestWasMade, false);
});

test('a sessão assinada pelo CHIP preserva o provedor institucional', () => {
    const token = createSessionToken({
        id: '00000000-0000-4000-8000-000000000000',
        email: null,
        user_metadata: { name: 'Pessoa Teste' },
        auth_provider: 'ldap'
    });

    assert.equal(verifySessionToken(token).auth_provider, 'ldap');
});
