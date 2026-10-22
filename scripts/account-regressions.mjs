import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import postgres from 'postgres';
import express from 'express';
import cookieParser from 'cookie-parser';

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl || !['localhost', '127.0.0.1'].includes(new URL(adminUrl).hostname)) throw new Error('Defina TEST_DATABASE_URL para um PostgreSQL local de testes com permissão de criar bancos.');
const admin = postgres(adminUrl, { max: 1, onnotice() {} });
const name = `chip_accounts_${randomUUID().replaceAll('-', '')}`;
const url = new URL(adminUrl);
url.pathname = `/${name}`;
let db, server, created = false;
try {
    await admin`CREATE DATABASE ${admin(name)}`;
    created = true;
    process.env.DATABASE_URL = url.href;
    process.env.APP_SESSION_SECRET = 'account-regression-session-secret-at-least-32-characters';
    process.env.NOTIFICATION_EMAIL_ENABLED = 'false';
    db = (await import('../backend/db.js')).default;
    const setup = await db.reserve();
    try {
        await setup.unsafe(await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'));
        for (const migration of ['google_login', 'reservations', 'google_only', 'indexes', 'session_version', 'pickup_deadline', 'return_conditions', 'loan_renewals', 'user_management', 'notifications', 'inventory_usage']) {
            await setup.unsafe(await readFile(new URL(`../database/migrations/${migration}.sql`, import.meta.url), 'utf8'));
        }
    } finally { setup.release(); }
    const { upsertGoogleUserProfile, getProfileByAuthUserId } = await import('../backend/services/userProfile.js');
    const { listManagedUsers, updateManagedUser, applyLateReturnPenalty } = await import('../backend/services/accountService.js');
    const { createSessionToken } = await import('../backend/services/sessionAuth.js');
    const { assertAccountIsActive } = await import('../backend/services/accountValidation.js');
    const accounts = [];
    for (const [index, level] of [2, 2, 1, 0].entries()) {
        const user = await upsertGoogleUserProfile({ sub: `accounts-${index}`, email: `accounts${index}@example.test`, name: `Pessoa Teste ${index}` });
        await db`UPDATE usuario SET nivel_acesso = ${level} WHERE id_usuario = ${user.id_usuario}`;
        accounts.push({ ...user, nivel_acesso: level });
    }
    const [firstAdmin, secondAdmin, tech, student] = accounts;
    const token = user => createSessionToken({ id: user.auth_user_id, email: user.email, auth_provider: 'google', session_version: user.session_version });
    const app = express();
    app.use(express.json(), cookieParser());
    app.use('/api', (await import('../backend/routes/users.js')).default);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api/gestao/usuarios`;
    const request = (path, user, body) => fetch(`${base}${path}`, {
        method: body ? 'PATCH' : 'GET', headers: { ...(user ? { Authorization: `Bearer ${token(user)}` } : {}), 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    assert.equal((await request('', null)).status, 401);
    assert.equal((await request('', student)).status, 403);
    const listed = await request('?limit=2', tech);
    assert.equal(listed.status, 200);
    const data = await listed.json();
    assert.equal(data.usuarios.length, 2);
    assert.equal(data.totalPages, 2);
    assert.ok(!/cpf|google_sub|auth_user_id|session_version|senha/.test(JSON.stringify(data)));
    assert.equal((await listManagedUsers({ search: 'accounts3@' })).total, 1);
    await assert.rejects(listManagedUsers({ page: 0 }), /Página inválida/);
    await assert.rejects(listManagedUsers({ limit: 51 }), /Página inválida/);
    assert.equal((await request(`/${student.id_usuario}/pedidos`, tech)).status, 200);
    assert.equal((await request(`/${student.id_usuario}`, tech, { name: 'Tentativa Técnico' })).status, 403);
    assert.equal((await request(`/${student.id_usuario}`, firstAdmin, { email: 'troca@example.test' })).status, 400);
    assert.equal((await request(`/${student.id_usuario}`, firstAdmin, { active: false })).status, 400);
    assert.equal((await request(`/${firstAdmin.id_usuario}`, firstAdmin, { accessLevel: 0, reason: 'Tentativa própria' })).status, 409);
    assert.equal((await request(`/${secondAdmin.id_usuario}`, firstAdmin, { active: false, reason: 'Tentativa bloqueio' })).status, 409);
    const before = await getProfileByAuthUserId(student.auth_user_id);
    assert.equal((await request(`/${student.id_usuario}`, firstAdmin, { name: 'Nome Corrigido', active: false, reason: 'Dano registrado na devolução' })).status, 200);
    const blocked = await getProfileByAuthUserId(student.auth_user_id);
    assert.equal(blocked.status_conta, false);
    assert.equal(blocked.session_version, before.session_version + 1);
    assert.throws(() => assertAccountIsActive(blocked), /bloqueada/);
    await updateManagedUser(firstAdmin.id_usuario, student.id_usuario, { active: true, reason: 'Pendência resolvida' });
    assert.equal((await request('', student)).status, 403, 'Sessão anterior ao bloqueio continua revogada após liberação');
    assert.match((await (await request('', student)).json()).message, /sessão foi encerrada/);
    const [{ today, due, expected }] = await db`SELECT current_date::text AS today, (current_date - 3)::text AS due, (current_date + 3)::text AS expected`;
    const createOrder = async user => (await db`INSERT INTO pedido (id_usuario, id_status) VALUES (${user.id_usuario}, (SELECT id_status FROM status_pedido WHERE descricao_status = 'Retirado')) RETURNING id_pedido`)[0].id_pedido;
    const orderId = await createOrder(student);
    const penalty = await db.begin(tx => applyLateReturnPenalty(tx, { userId: student.id_usuario, orderId, dueDate: due, actorId: tech.id_usuario, ip: '127.0.0.1' }));
    assert.equal(penalty.dias_bloqueio, 3);
    assert.equal(penalty.bloqueio_automatico_ate, expected);
    assert.equal(await db.begin(tx => applyLateReturnPenalty(tx, { userId: student.id_usuario, orderId, dueDate: due, actorId: tech.id_usuario })), null);
    const automatic = await getProfileByAuthUserId(student.auth_user_id);
    assert.equal(automatic.status_conta, true, 'Penalidade automática não altera bloqueio manual');
    assert.equal(automatic.bloqueio_automatico_ativo, true);
    assert.throws(() => assertAccountIsActive(automatic), /bloqueada/);
    const secondOrder = await createOrder(student);
    const thirdOrder = await createOrder(student);
    await Promise.all([secondOrder, thirdOrder].map(id => db.begin(tx => applyLateReturnPenalty(tx, { userId: student.id_usuario, orderId: id, dueDate: due, actorId: tech.id_usuario }))));
    const [{ stacked }] = await db`SELECT (current_date + 9)::text AS stacked`;
    assert.equal((await getProfileByAuthUserId(student.auth_user_id)).bloqueio_automatico_ate, stacked);
    assert.equal((await db`SELECT count(*)::int AS n FROM penalidade_atraso`)[0].n, 3);
    assert.equal((await db`SELECT count(*)::int AS n FROM notificacao WHERE chave_evento LIKE ${`${student.id_usuario}:pedido:%:penalidade`}`)[0].n, 3);
    await db`UPDATE usuario SET bloqueio_automatico_ate = current_date WHERE id_usuario = ${student.id_usuario}`;
    assert.doesNotThrow(() => assertAccountIsActive({ ...automatic, bloqueio_automatico_ativo: false }));
    const expired = await getProfileByAuthUserId(student.auth_user_id);
    assert.equal(expired.bloqueio_automatico_ativo, false, 'Prazo termina automaticamente no dia limite pelo relógio do banco');
    assert.doesNotThrow(() => assertAccountIsActive(expired));
    const onTimeId = await createOrder(student);
    assert.equal(await db.begin(tx => applyLateReturnPenalty(tx, { userId: student.id_usuario, orderId: onTimeId, dueDate: today, actorId: tech.id_usuario })), null);
    const adminOrder = await createOrder(firstAdmin);
    assert.equal(await db.begin(tx => applyLateReturnPenalty(tx, { userId: firstAdmin.id_usuario, orderId: adminOrder, dueDate: due, actorId: tech.id_usuario })), null);
    const lateId = await createOrder(student);
    await db.begin(tx => applyLateReturnPenalty(tx, { userId: student.id_usuario, orderId: lateId, dueDate: due, actorId: tech.id_usuario }));
    await updateManagedUser(firstAdmin.id_usuario, student.id_usuario, { clearAutomaticPenalty: true, reason: 'Revisão administrativa da penalidade' });
    assert.equal((await getProfileByAuthUserId(student.auth_user_id)).bloqueio_automatico_ativo, false);
    assert.equal((await db`SELECT count(*)::int AS n FROM penalidade_atraso`)[0].n, 4, 'Liberação administrativa preserva registro histórico');
    // Uma operação do solicitante ainda pode notificar/auditar a equipe enquanto a gestão aguarda sua trava.
    const holder = await db.reserve();
    let editing, committed = false;
    try {
        await holder`BEGIN`;
        await holder`SET LOCAL lock_timeout = '2s'`;
        await holder`SELECT id_usuario FROM usuario WHERE id_usuario = ${student.id_usuario} FOR UPDATE`;
        editing = updateManagedUser(firstAdmin.id_usuario, student.id_usuario, { name: 'Nome Sem Deadlock' });
        let waiting = false;
        for (let attempt = 0; attempt < 200; attempt++) {
            const [state] = await admin`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = ${name}
                AND wait_event_type = 'Lock' AND query LIKE '%id_usuario IN (%'`;
            if (state.n) { waiting = true; break; }
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(waiting, true, 'Gestão deve aguardar a operação corrente do usuário');
        await holder`INSERT INTO log_auditoria (acao, id_usuario) VALUES ('regressao:fk_equipe', ${firstAdmin.id_usuario})`;
        await holder`COMMIT`;
        committed = true;
    } finally {
        if (!committed) await holder`ROLLBACK`;
        holder.release();
        if (editing) await editing;
    }
    const concurrent = await Promise.allSettled([
        updateManagedUser(firstAdmin.id_usuario, secondAdmin.id_usuario, { accessLevel: 0, reason: 'Troca de equipe A' }),
        updateManagedUser(secondAdmin.id_usuario, firstAdmin.id_usuario, { accessLevel: 0, reason: 'Troca de equipe B' })
    ]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await db`SELECT count(*)::int AS n FROM usuario WHERE nivel_acesso = 2 AND status_conta`)[0].n, 1);
    assert.ok((await db`SELECT count(*)::int AS n FROM log_auditoria WHERE acao = 'usuario:alterar'`)[0].n >= 4);
    console.log('OK: gestão paginada, permissões, privacidade, histórico, revogação, auditoria, penalidades idempotentes/concorrentes e proteção do último administrador.');
} finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.end({ timeout: 2 });
    if (created) await admin`DROP DATABASE ${admin(name)}`;
    await admin.end();
}
