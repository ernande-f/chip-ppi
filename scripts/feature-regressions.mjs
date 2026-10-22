import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { chromium } from 'playwright';

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl || !['localhost', '127.0.0.1'].includes(new URL(adminUrl).hostname)) throw new Error('Defina TEST_DATABASE_URL para PostgreSQL local de testes.');
const admin = postgres(adminUrl, { max: 1, onnotice() {} });
const name = `chip_features_${randomUUID().replaceAll('-', '')}`;
const url = new URL(adminUrl); url.pathname = `/${name}`;
let created = false, db, child, browser;
try {
    await admin`CREATE DATABASE ${admin(name)}`; created = true;
    Object.assign(process.env, { DATABASE_URL: url.href, APP_SESSION_SECRET: 'feature-test-secret-at-least-32-characters',
        GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_ALLOWED_DOMAINS: 'aluno.iffar.edu.br,iffarroupilha.edu.br', NOTIFICATION_EMAIL_ENABLED: 'false' });
    db = (await import('../backend/db.js')).default;
    const setup = await db.reserve();
    try {
        await setup.unsafe(await readFile('database/schema.sql', 'utf8'));
        for (const migration of ['google_login', 'reservations', 'google_only', 'indexes', 'session_version', 'pickup_deadline', 'return_conditions', 'loan_renewals', 'user_management', 'notifications', 'inventory_usage']) await setup.unsafe(await readFile(`database/migrations/${migration}.sql`, 'utf8'));
    } finally { setup.release(); }
    const { upsertGoogleUserProfile } = await import('../backend/services/userProfile.js');
    const { createSessionToken } = await import('../backend/services/sessionAuth.js');
    const { createProduct } = await import('../backend/services/productService.js');
    const { addCartItem, checkoutCart, transitionOrder } = await import('../backend/services/orderService.js');
    const { CURRENT_TERMS_VERSION } = await import('../backend/services/orderRules.js');
    const student = await upsertGoogleUserProfile({ sub: 'feature-student', email: 'feature@aluno.iffar.edu.br', name: 'Estudante de Testes' });
    const tech = await upsertGoogleUserProfile({ sub: 'feature-tech', email: 'feature.tech@iffarroupilha.edu.br', name: 'Técnico de Testes' });
    const manager = await upsertGoogleUserProfile({ sub: 'feature-admin', email: 'feature.admin@iffarroupilha.edu.br', name: 'Administrador de Testes' });
    await db`UPDATE usuario SET nivel_acesso = 1 WHERE id_usuario = ${tech.id_usuario}`;
    await db`UPDATE usuario SET nivel_acesso = 2 WHERE id_usuario = ${manager.id_usuario}`;
    const product = await createProduct({ nome: 'Kit integrado', descricao_produto: 'Teste de todas as novas funcionalidades', estoque_total: 10, foto_produto: 'data:image/png;base64,AA==', categorias: ['Teste'] });
    await addCartItem(student.id_usuario, product.id_produto, 3);
    const order = await checkoutCart(student.id_usuario, { durationDays: 7, acceptedTerms: true, termsVersion: CURRENT_TERMS_VERSION });
    let picked;
    for (const action of ['approve', 'start_separation', 'mark_ready', 'confirm_pickup']) picked = await transitionOrder(tech.id_usuario, order.id_pedido, action);

    const probe = createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const base = `http://localhost:${port}`;
    child = spawn(process.execPath, ['backend/server.js'], { env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), APP_URL: base }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stderr.on('data', data => { output += data; });
    await new Promise((resolve, reject) => {
        child.once('error', reject); child.once('exit', code => reject(new Error(`Servidor encerrou (${code}): ${output}`)));
        child.stdout.on('data', data => { if (String(data).includes('Servidor rodando')) resolve(); });
    });
    const tokenFor = user => createSessionToken({ id: user.auth_user_id, email: user.email, auth_provider: 'google', session_version: user.session_version });
    const request = (path, user, method = 'GET', body) => fetch(base + path, { method, headers: { Origin: base,
        ...(user ? { Authorization: `Bearer ${tokenFor(user)}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual' });
    for (const path of ['/api/gestao/usuarios', '/api/gestao/relatorios', '/api/gestao/relatorios/exportar.csv']) {
        assert.equal((await request(path)).status, 401);
        assert.equal((await request(path, student)).status, 403);
        assert.equal((await request(path, tech)).status, 200);
    }
    for (const path of ['/usuarios.html', '/relatorios.html', '/pages/usuarios.html', '/pages/relatorios.HTML']) assert.equal((await request(path, student)).status, 302);
    const requestedDate = new Date(Date.parse(picked.data_prevista_devolucao) + 3 * 86_400_000).toISOString().slice(0, 10);
    const renewalResponse = await request(`/api/pedidos/${order.id_pedido}/renovacoes`, student, 'POST', { requestedDate, justification: 'Finalizar o projeto de teste' });
    assert.equal(renewalResponse.status, 201);
    const pending = (await renewalResponse.json()).pedido;
    assert.equal(pending.data_prevista_devolucao, picked.data_prevista_devolucao);
    const decision = await request(`/api/gestao/pedidos/${order.id_pedido}/renovacoes/${pending.renovacoes[0].id_renovacao}`, tech, 'PATCH', { approved: true });
    assert.equal(decision.status, 200);
    assert.equal((await decision.json()).pedido.data_prevista_devolucao, requestedDate);
    assert.equal((await request(`/api/pedidos/${order.id_pedido}/repetir`, student, 'POST')).status, 200);
    assert.equal((await request('/api/carrinho', student).then(response => response.json())).itens[0].quantidade, 3);
    const notificationData = await request('/api/notificacoes', student).then(response => response.json());
    assert.ok(notificationData.nao_lidas >= 3);
    assert.equal((await request(`/api/notificacoes/${notificationData.notificacoes[0].id_notificacao}/lida`, tech, 'PATCH')).status, 404);
    assert.equal((await request('/api/notificacoes/envios', manager).then(response => response.json())).habilitado, false);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    const cookie = user => ({ name: 'authcookie', value: tokenFor(user), url: base });
    await context.addCookies([cookie(manager)]);
    const artifacts = join(tmpdir(), 'chip-feature-artifacts'); await mkdir(artifacts, { recursive: true });
    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        for (const file of ['usuarios.html', 'relatorios.html', 'notificacoes.html']) {
            await page.goto(`${base}/${file}`);
            await page.locator('#contrastToggle').waitFor();
            if (file === 'relatorios.html') await page.locator('#reportContent:not([hidden])').waitFor();
            if (file === 'usuarios.html') await page.locator('#usersList button').first().waitFor();
            if (file === 'notificacoes.html') await page.getByRole('heading', { name: 'Envio de e-mails' }).waitFor();
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${file} em ${width}px`);
        }
    }
    await page.locator('#contrastToggle').click();
    assert.equal(await page.locator('html').getAttribute('data-contrast'), 'high');
    await page.goto(`${base}/relatorios.html`);
    await page.locator('#reportContent:not([hidden])').waitFor();
    assert.equal(await page.locator('#contrastToggle').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(0, 0, 0)');
    await page.screenshot({ path: join(artifacts, 'reports-high-contrast.png'), fullPage: true });
    await page.locator('#contrastToggle').click();
    await page.screenshot({ path: join(artifacts, 'reports.png'), fullPage: true });
    await context.addCookies([cookie(student)]);
    await page.goto(`${base}/notificacoes.html`);
    await page.locator('.notification-card').first().waitFor();
    await page.getByRole('button', { name: 'Marcar todas como lidas' }).click();
    await page.locator('#notificationStatus').getByText('0 notificação(ões) não lida(s).', { exact: true }).waitFor();
    await page.screenshot({ path: join(artifacts, 'notifications.png'), fullPage: true });
    assert.equal((await request('/api/notificacoes', student).then(response => response.json())).nao_lidas, 0);
    assert.deepEqual(errors, []);
    assert.equal((await request(`/api/gestao/usuarios/${student.id_usuario}`, tech, 'PATCH', { active: false, reason: 'Teste' })).status, 403);
    assert.equal((await request(`/api/gestao/usuarios/${student.id_usuario}`, manager, 'PATCH', { active: false, reason: 'Bloqueio de teste' })).status, 200);
    assert.equal((await request('/api/pedidos', student)).status, 403);
    assert.equal((await request('/api/produtos', student)).status, 200);
    console.log(`OK: servidor real integra usuários, permissões, renovação, repetição, notificações, relatórios, alto contraste persistente e telas em 320/390/1280px. Capturas: ${artifacts}`);
} finally {
    if (browser) await browser.close();
    if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    if (db) await db.end();
    if (created) await admin`DROP DATABASE ${admin(name)}`;
    await admin.end();
}
