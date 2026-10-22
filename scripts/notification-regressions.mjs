import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import postgres from 'postgres';
import express from 'express';
import cookieParser from 'cookie-parser';

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl || !['localhost', '127.0.0.1'].includes(new URL(adminUrl).hostname)) throw new Error('Defina TEST_DATABASE_URL para PostgreSQL local de testes.');
const admin = postgres(adminUrl, { max: 1, onnotice() {} });
const name = `chip_notifications_${randomUUID().replaceAll('-', '')}`;
const url = new URL(adminUrl); url.pathname = `/${name}`;
let created = false, db, server, lockConnection, holder;
try {
    await admin`CREATE DATABASE ${admin(name)}`; created = true;
    process.env.DATABASE_URL = url.href;
    process.env.APP_URL = 'http://localhost:3000';
    process.env.APP_SESSION_SECRET = 'notification-regression-secret-at-least-32-characters';
    process.env.NOTIFICATION_EMAIL_ENABLED = 'false';
    db = (await import('../backend/db.js')).default;
    const setup = await db.reserve();
    try {
        await setup.unsafe(await readFile('database/schema.sql', 'utf8'));
        await setup`INSERT INTO notificacao (mensagem,data_notificacao) VALUES ('Notificação legada',current_date - 5)`;
        for (const migration of ['google_login', 'reservations', 'google_only', 'indexes', 'session_version', 'pickup_deadline', 'return_conditions', 'loan_renewals', 'user_management', 'notifications', 'inventory_usage']) {
            await setup.unsafe(await readFile(`database/migrations/${migration}.sql`, 'utf8'));
        }
    } finally { setup.release(); }
    assert.equal((await db`SELECT criada_em::date = current_date - 5 AS preserved FROM notificacao WHERE mensagem = 'Notificação legada'`)[0].preserved, true);
    const { upsertGoogleUserProfile } = await import('../backend/services/userProfile.js');
    const { createSessionToken } = await import('../backend/services/sessionAuth.js');
    const { enqueueNotification, listNotifications, markNotificationRead, enqueueDueReminders, processNotificationEmails } = await import('../backend/services/notificationService.js');
    const student = await upsertGoogleUserProfile({ sub: 'notify-student', email: 'notify@aluno.iffar.edu.br', name: 'Estudante Notificações' });
    const other = await upsertGoogleUserProfile({ sub: 'notify-other', email: 'other@aluno.iffar.edu.br', name: 'Outra Pessoa' });
    const payload = { userId: student.id_usuario, eventKey: 'notify:test', message: 'Pedido aprovado <script>não executar</script>', href: '/pedidos' };
    const notifications = await Promise.all([1, 2].map(() => db.begin(tx => enqueueNotification(tx, payload))));
    const notificationId = notifications.find(Boolean);
    assert.equal(notifications.filter(Boolean).length, 1, 'Evento simultâneo gera uma notificação');
    assert.equal((await listNotifications(student.id_usuario)).nao_lidas, 1);
    assert.equal(await markNotificationRead(other.id_usuario, notificationId), false);
    await assert.rejects(db.begin(async tx => { await enqueueNotification(tx, { ...payload, eventKey: 'rollback' }); throw new Error('rollback'); }));
    assert.equal((await listNotifications(student.id_usuario)).total, 1);
    const app = express(); app.use(express.json(), cookieParser());
    app.use('/api/notificacoes', (await import('../backend/routes/notifications.js')).default);
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api/notificacoes`;
    const headers = user => ({ Authorization: `Bearer ${createSessionToken({ id: user.auth_user_id, email: user.email, auth_provider: 'google', session_version: 0 })}` });
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(`${base}/${notificationId}/lida`, { method: 'PATCH', headers: headers(other) })).status, 404);
    assert.equal((await fetch(`${base}/envios`, { headers: headers(student) })).status, 403);
    assert.equal((await fetch(`${base}/${notificationId}/lida`, { method: 'PATCH', headers: headers(student) })).status, 200);
    assert.equal((await listNotifications(student.id_usuario)).nao_lidas, 0);
    for (let index = 0; index < 22; index++) await db.begin(tx => enqueueNotification(tx, { ...payload, eventKey: `page:${index}` }));
    assert.equal((await listNotifications(student.id_usuario, { page: 2 })).notificacoes.length, 3);
    assert.equal((await listNotifications(student.id_usuario, { unreadOnly: true })).total, 22);
    assert.equal((await listNotifications(other.id_usuario)).total, 0);

    const [status] = await db`SELECT id_status FROM status_pedido WHERE descricao_status = 'Retirado'`;
    const [order] = await db`INSERT INTO pedido (id_usuario,id_status,data_retirada,duracao_dias)
        VALUES (${student.id_usuario},${status.id_status},current_date - 5,7) RETURNING id_pedido`;
    await Promise.all([enqueueDueReminders(), enqueueDueReminders()]);
    assert.equal((await db`SELECT count(*)::int AS n FROM notificacao WHERE chave_evento LIKE ${`%:lembrete:${order.id_pedido}:%`}`)[0].n, 1);
    const [renewal] = await db`INSERT INTO renovacao (data_estendida,status) VALUES (current_date + 6,'Aprovada') RETURNING id_renovacao`;
    await db`INSERT INTO renovacao_pedido VALUES (${renewal.id_renovacao},${order.id_pedido})`;
    await enqueueDueReminders();
    assert.equal((await db`SELECT count(*)::int AS n FROM notificacao WHERE chave_evento LIKE ${`%:lembrete:${order.id_pedido}:%`}`)[0].n, 1, 'Prazo renovado não dispara lembrete antigo');

    const [race] = await db`INSERT INTO pedido (id_usuario,id_status,data_retirada,duracao_dias)
        VALUES (${other.id_usuario},${status.id_status},current_date - 6,7) RETURNING id_pedido`;
    lockConnection = postgres(url.href, { max: 1, onnotice() {} });
    holder = await lockConnection.reserve(); await holder`BEGIN`;
    await holder`SELECT id_pedido FROM pedido WHERE id_pedido = ${race.id_pedido} FOR UPDATE`;
    const reminder = enqueueDueReminders();
    let blocked = false;
    for (let attempt = 0; attempt < 200; attempt++) {
        const [waiting] = await admin`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = ${name} AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE OF p%'`;
        if (waiting.n) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(blocked, true);
    await holder`UPDATE pedido SET id_status = (SELECT id_status FROM status_pedido WHERE descricao_status = 'Devolvido') WHERE id_pedido = ${race.id_pedido}`;
    await holder`COMMIT`; holder.release(); holder = null; await reminder;
    assert.equal((await db`SELECT count(*)::int AS n FROM notificacao WHERE chave_evento LIKE ${`%:lembrete:${race.id_pedido}:%`}`)[0].n, 0, 'Devolução concorrente impede lembrete obsoleto');

    process.env.NOTIFICATION_EMAIL_ENABLED = 'true'; process.env.RESEND_API_KEY = 'fake-only-tests'; process.env.EMAIL_FROM = 'chip@example.test';
    const mailId = await db.begin(tx => enqueueNotification(tx, { ...payload, eventKey: 'mail:success' }));
    const sent = [];
    const fakeFetch = async (url, options) => { sent.push({ url, options }); return new Response('{}'); };
    await Promise.all([processNotificationEmails({ fetchImpl: fakeFetch }), processNotificationEmails({ fetchImpl: fakeFetch })]);
    assert.equal(sent.length, 1, 'Dois workers enviam uma única ocorrência');
    assert.equal((await db`SELECT estado FROM notificacao_email WHERE id_notificacao = ${mailId}`)[0].estado, 'enviado');
    const failedId = await db.begin(tx => enqueueNotification(tx, { ...payload, eventKey: 'mail:failure' }));
    await processNotificationEmails({ fetchImpl: async () => new Response('{}', { status: 429 }) });
    let [failed] = await db`SELECT * FROM notificacao_email WHERE id_notificacao = ${failedId}`;
    assert.equal(failed.estado, 'pendente'); assert.equal(failed.tentativas, 1); assert.equal(failed.ultimo_erro, 'HTTP 429');
    await db`UPDATE notificacao_email SET disponivel_em = now() - interval '1 minute' WHERE id_notificacao = ${failedId}`;
    await processNotificationEmails({ fetchImpl: fakeFetch });
    assert.equal((await db`SELECT estado FROM notificacao_email WHERE id_notificacao = ${failedId}`)[0].estado, 'enviado');
    const orphanId = await db.begin(tx => enqueueNotification(tx, { ...payload, eventKey: 'mail:orphan' }));
    await db`UPDATE notificacao_email SET estado = 'enviando',tentativas = 5,reservado_em = now() - interval '6 minutes' WHERE id_notificacao = ${orphanId}`;
    await processNotificationEmails({ fetchImpl: () => assert.fail('Última tentativa perdida não deve ser reenviada') });
    assert.equal((await db`SELECT estado FROM notificacao_email WHERE id_notificacao = ${orphanId}`)[0].estado, 'falha');
    assert.equal((await db`SELECT estado FROM notificacao_email WHERE id_notificacao = ${notificationId}`)[0].estado, 'desativado', 'Habilitar envio não dispara eventos antigos');
    console.log('OK: notificações privadas, leitura/paginação, deduplicação, transação, lembretes com renovação/concorrência e fila com workers/repetição/recuperação, sem envio real.');
} finally {
    if (holder) { await holder`ROLLBACK`; holder.release(); }
    if (server) { server.close(); await once(server, 'close'); }
    if (lockConnection) await lockConnection.end();
    if (db) await db.end();
    if (created) await admin`DROP DATABASE ${admin(name)}`;
    await admin.end();
}
