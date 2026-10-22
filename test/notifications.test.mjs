import assert from 'node:assert/strict';
import test from 'node:test';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
const { getEmailConfig, sendNotificationEmail } = await import('../backend/services/notificationService.js');

test('e-mail é opcional e habilitação exige remetente e chave', () => {
    assert.equal(getEmailConfig({}).enabled, false);
    for (const env of [
        { NOTIFICATION_EMAIL_ENABLED: 'yes' },
        { NOTIFICATION_EMAIL_ENABLED: 'true' },
        { NOTIFICATION_EMAIL_ENABLED: 'true', RESEND_API_KEY: 'test', EMAIL_FROM: 'invalid' }
    ]) assert.throws(() => getEmailConfig(env));
    assert.equal(getEmailConfig({ NOTIFICATION_EMAIL_ENABLED: 'true', RESEND_API_KEY: 'test', EMAIL_FROM: 'chip@example.test' }).enabled, true);
});

test('envio usa chave idempotente, texto simples e timeout sem acessar rede real', async () => {
    const calls = [];
    const job = { id_usuario: '4', id_notificacao: '8', email: 'person@example.test', mensagem: '<script>não é HTML</script>', href: '/pedidos' };
    const options = { appUrl: 'https://chip.example.test', config: { enabled: true, apiKey: 'fake-key', from: 'chip@example.test' },
        fetchImpl: async (...args) => { calls.push(args); return new Response('{}'); } };
    await sendNotificationEmail(job, options);
    await sendNotificationEmail(job, options);
    assert.equal(calls[0][0], 'https://api.resend.com/emails');
    assert.equal(calls[0][1].headers['Idempotency-Key'], calls[1][1].headers['Idempotency-Key']);
    const payload = JSON.parse(calls[0][1].body);
    assert.equal(payload.html, undefined);
    assert.match(payload.text, /https:\/\/chip.example.test\/pedidos$/);
    assert.equal(calls[0][1].signal.aborted, false);
    await assert.rejects(sendNotificationEmail(job, { ...options, fetchImpl: async () => new Response('{}', { status: 429 }) }), /HTTP 429/);
    assert.equal(await sendNotificationEmail(job, { ...options, config: { enabled: false }, fetchImpl: () => assert.fail('Não deve enviar') }), false);
});
