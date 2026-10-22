import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import postgres from 'postgres';

// Cria e remove apenas bancos temporários de nomes aleatórios em um PostgreSQL local.
const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl || !['localhost', '127.0.0.1'].includes(new URL(adminUrl).hostname)) throw new Error('Defina TEST_DATABASE_URL para um PostgreSQL local de testes.');
const admin = postgres(adminUrl, { max: 1, onnotice() {} });
const suffix = randomUUID().replaceAll('-', '');
const names = [`chip_smoke_${suffix}`, `chip_copy_${suffix}`];
const urls = names.map(name => { const url = new URL(adminUrl); url.pathname = `/${name}`; return url.href; });
const created = [];
let db, target, child, browser;
const run = async (file, env, args = []) => {
    const process = spawn(globalThis.process.execPath, [file, ...args], { env: { ...globalThis.process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    process.stdout.on('data', data => { output += data; });
    process.stderr.on('data', data => { output += data; });
    const [code] = await once(process, 'exit');
    if (code) throw new Error(output);
};
try {
    for (const name of names) {
        await admin`CREATE DATABASE ${admin(name)}`;
        created.push(name);
        await admin`ALTER DATABASE ${admin(name)} SET timezone TO 'UTC'`;
    }
    process.env.DATABASE_URL = urls[0];
    process.env.APP_SESSION_SECRET = 'temporary-smoke-secret-at-least-32-characters';
    process.env.GOOGLE_CLIENT_ID = 'test-client';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    process.env.GOOGLE_ALLOWED_DOMAINS = 'aluno.iffar.edu.br,iffarroupilha.edu.br';
    db = (await import('../backend/db.js')).default;
    target = postgres(urls[1], { max: 1, onnotice() {} });
    assert.equal((await db`SHOW timezone`)[0].TimeZone, 'America/Sao_Paulo');
    const schema = await readFile('database/schema.sql', 'utf8');
    for (const connection of [db, target]) {
        const setup = await connection.reserve();
        try {
            await setup.unsafe(schema);
            if (connection === target) await setup`ALTER TABLE usuario DROP COLUMN session_version`;
            for (const file of ['google_login', 'reservations', 'google_only', 'indexes', 'session_version', 'pickup_deadline', 'return_conditions', 'loan_renewals', 'user_management', 'notifications', 'inventory_usage']) await setup.unsafe(await readFile(`database/migrations/${file}.sql`, 'utf8'));
        } finally { await setup.release(); }
    }
    const { upsertGoogleUserProfile } = await import('../backend/services/userProfile.js');
    const { createSessionToken } = await import('../backend/services/sessionAuth.js');
    const student = await upsertGoogleUserProfile({ sub: 'student', email: 'student@aluno.iffar.edu.br', name: 'Estudante Teste' });
    await db`UPDATE usuario SET cpf = '12345678909' WHERE id_usuario = ${student.id_usuario}`;
    let tech = await upsertGoogleUserProfile({ sub: 'tech', email: 'tech@iffarroupilha.edu.br', name: 'Técnico Teste' });
    await db`UPDATE usuario SET nivel_acesso = 1 WHERE id_usuario = ${tech.id_usuario}`;
    tech = await upsertGoogleUserProfile({ sub: 'tech', email: 'tech@iffarroupilha.edu.br', name: 'Outro Nome' });
    assert.equal(tech.nivel_acesso, 1);
    assert.equal(tech.nome, 'Técnico Teste');
    const legacyId = randomUUID();
    await db`INSERT INTO usuario (auth_user_id, nome, email, nivel_acesso, status_conta) VALUES (${legacyId}, 'Legado', 'legacy@iffarroupilha.edu.br', 2, false)`;
    const linked = await upsertGoogleUserProfile({ sub: 'legacy', email: 'legacy@iffarroupilha.edu.br', name: 'Google' });
    assert.equal(linked.auth_user_id, legacyId);
    assert.equal(linked.status_conta, false);
    assert.equal(linked.nivel_acesso, 2);
    await assert.rejects(upsertGoogleUserProfile({ sub: 'other', email: 'legacy@iffarroupilha.edu.br', name: 'Outro' }));
    const { createProduct, deleteProduct, getProductById } = await import('../backend/services/productService.js');
    const product = await createProduct({ nome: 'Arduino de teste', descricao_produto: 'Placa para testar reservas', estoque_total: 4, foto_produto: 'https://example.invalid/photo.png', categorias: ['Eletrônica'] });
    const archived = await createProduct({ nome: 'Item arquivado', descricao_produto: 'Não deve aparecer', estoque_total: 2, foto_produto: 'https://example.invalid/photo.png', categorias: ['Eletrônica'] });
    await deleteProduct(archived.id_produto);
    assert.equal((await getProductById(archived.id_produto)).status_produto, 'Arquivado');
    assert.equal((await db`SELECT count(*)::int AS total FROM categorizar WHERE id_produto = ${archived.id_produto}`)[0].total, 1);
    const { CURRENT_TERMS_VERSION } = await import("../backend/services/orderRules.js");
    const { addCartItem, checkoutCart, transitionOrder, cancelUserOrder, expireUncollectedOrders, listUserOrders } = await import('../backend/services/orderService.js');
    await addCartItem(student.id_usuario, product.id_produto, 1);
    await assert.rejects(checkoutCart(student.id_usuario, {
        durationDays: 7, acceptedTerms: true, termsVersion: CURRENT_TERMS_VERSION, reservationStart: '2026-10-23', reservationEnd: '2026-10-30'
    }), /agendamento por datas foi removido/);
    const reserved = await checkoutCart(student.id_usuario, { durationDays: 7, acceptedTerms: true, termsVersion: CURRENT_TERMS_VERSION });
    assert.equal(reserved.data_aprovacao, null);
    assert.equal(reserved.data_prevista_devolucao, null);
    for (const action of ['approve', 'start_separation', 'mark_ready']) await transitionOrder(tech.id_usuario, reserved.id_pedido, action);
    await cancelUserOrder(student.id_usuario, reserved.id_pedido);
    assert.equal((await db`SELECT estoque_total FROM produto WHERE id_produto = ${product.id_produto}`)[0].estoque_total, 4);
    await assert.rejects(cancelUserOrder(student.id_usuario, reserved.id_pedido));

    await addCartItem(student.id_usuario, product.id_produto, 1);
    const collected = await checkoutCart(student.id_usuario, { durationDays: 7, acceptedTerms: true, termsVersion: CURRENT_TERMS_VERSION });
    await transitionOrder(tech.id_usuario, collected.id_pedido, 'approve');
    await db`UPDATE pedido SET data_aprovacao = current_date - 10,
        retirada_prevista = current_date + 20, devolucao_prevista = current_date + 21
        WHERE id_pedido = ${collected.id_pedido}`;
    for (const action of ['start_separation', 'mark_ready']) await transitionOrder(tech.id_usuario, collected.id_pedido, action);
    assert.equal((await db`SELECT data_aprovacao = current_date - 10 AS unchanged FROM pedido WHERE id_pedido = ${collected.id_pedido}`)[0].unchanged, true);
    const pickedUp = await transitionOrder(tech.id_usuario, collected.id_pedido, 'confirm_pickup');
    const [{ due }] = await db`SELECT (current_date + 7)::text AS due`;
    assert.equal(new Date(pickedUp.data_prevista_devolucao).toISOString().slice(0, 10), due);
    await db`UPDATE pedido SET data_aprovacao = current_date - 30 WHERE id_pedido = ${collected.id_pedido}`;
    await expireUncollectedOrders();
    assert.equal((await listUserOrders(student.id_usuario)).find(row => row.id_pedido === collected.id_pedido).status, 'Retirado');
    await transitionOrder(tech.id_usuario, collected.id_pedido, 'register_return');
    await assert.rejects(transitionOrder(tech.id_usuario, collected.id_pedido, 'register_return'));
    assert.equal((await db`SELECT estoque_total FROM produto WHERE id_produto = ${product.id_produto}`)[0].estoque_total, 4);

    await addCartItem(student.id_usuario, product.id_produto, 1);
    const expired = await checkoutCart(student.id_usuario, { durationDays: 7, acceptedTerms: true, termsVersion: CURRENT_TERMS_VERSION });
    for (const action of ['approve', 'start_separation', 'mark_ready']) await transitionOrder(tech.id_usuario, expired.id_pedido, action);
    await db`UPDATE pedido SET data_aprovacao = current_date - 11 WHERE id_pedido = ${expired.id_pedido}`;
    await Promise.all([expireUncollectedOrders(), expireUncollectedOrders()]);
    const expiredOrder = (await listUserOrders(student.id_usuario)).find(row => row.id_pedido === expired.id_pedido);
    assert.equal(expiredOrder.status, 'Expirado');
    assert.equal(expiredOrder.data_retirada, null);
    assert.equal(expiredOrder.data_prevista_devolucao, null);
    assert.equal((await db`SELECT estoque_total FROM produto WHERE id_produto = ${product.id_produto}`)[0].estoque_total, 4);
    assert.equal((await db`SELECT count(*)::int AS n FROM log_auditoria WHERE acao = 'pedido:expire' AND id_usuario IS NULL`)[0].n, 1);
    await assert.rejects(transitionOrder(tech.id_usuario, expired.id_pedido, 'confirm_pickup'));
    await assert.rejects(cancelUserOrder(student.id_usuario, expired.id_pedido));
    await expireUncollectedOrders();
    assert.equal((await db`SELECT estoque_total FROM produto WHERE id_produto = ${product.id_produto}`)[0].estoque_total, 4);

    await addCartItem(student.id_usuario, product.id_produto, 1);
    const order = await checkoutCart(student.id_usuario, { durationDays: 7, acceptedTerms: true, termsVersion: CURRENT_TERMS_VERSION });
    const returnProduct = await createProduct({ nome: 'Kit para devolução', descricao_produto: 'Conferência de devolução e arquivamento', estoque_total: 5, foto_produto: 'https://example.invalid/photo.png', categorias: ['Eletrônica'] });
    await addCartItem(student.id_usuario, returnProduct.id_produto, 3);
    const returnOrder = await checkoutCart(student.id_usuario, { durationDays: 7, acceptedTerms: true, termsVersion: CURRENT_TERMS_VERSION });
    for (const action of ['approve', 'start_separation', 'mark_ready', 'confirm_pickup']) await transitionOrder(tech.id_usuario, returnOrder.id_pedido, action);
    await deleteProduct(returnProduct.id_produto);


    const probe = createServer().listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
    child = spawn(process.execPath, ['backend/server.js'], { env: { ...process.env, NODE_ENV: 'test', PORT: String(port), APP_URL: `http://localhost:${port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    const base = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`Servidor terminou: ${code}`)));
        child.stdout.on('data', data => { const match = String(data).match(/http:\/\/localhost:\d+/); if (match) resolve(match[0]); });
    });
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(15_000);
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.goto(base);
    await page.getByRole('heading', { name: 'Arduino de teste' }).waitFor();
    assert.equal(await page.getByText('Item arquivado', { exact: true }).count(), 0);
    assert.equal(await page.locator('.orders-section').isVisible(), false);
    await page.getByRole('button', { name: 'Entre para solicitar este item' }).click();
    await page.waitForURL('**/login');
    await page.getByRole('link', { name: 'Entrar com Google' }).waitFor();
    const cookieFor = profile => ({ name: 'authcookie', value: createSessionToken({ id: profile.auth_user_id, email: profile.email, auth_provider: 'google', session_version: profile.session_version }), url: base });
    await context.addCookies([cookieFor(student)]);
    const studentHeaders = { Cookie: `authcookie=${cookieFor(student).value}`, Origin: base };
    for (const method of ['GET', 'HEAD']) {
        for (const protectedPath of ['/pages/pedidos%2Ehtml', '/pages/%70edidos.HTML', '/pages/./pedidos.html']) {
            const response = await fetch(`${base}${protectedPath}`, { method, headers: studentHeaders, redirect: 'manual' });
            assert.equal(response.status, 302);
            assert.equal(response.headers.get('location'), '/');
        }
        const profilePage = await fetch(`${base}/pages/perfil%2Ehtml`, { method, headers: studentHeaders });
        assert.equal(profilePage.status, 200);
        assert.equal(profilePage.headers.get('cache-control'), 'no-store');
    }
    for (const privatePath of ['/api/session', '/api/profile', '/api/pedidos', '/api/carrinho']) {
        const response = await fetch(`${base}${privatePath}`, { headers: studentHeaders });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const payload = await response.json();
        if (payload.profile) {
            assert.equal(payload.profile.cpf, '***.***.***-09');
            assert.equal(payload.profile.google_sub, undefined);
            assert.equal(payload.profile.session_version, undefined);
        }
    }
    const editedProfile = await fetch(`${base}/api/profile`, {
        method: 'PATCH', headers: { ...studentHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: student.nome })
    });
    assert.equal(editedProfile.status, 200);
    assert.equal((await editedProfile.json()).profile.cpf, '***.***.***-09');
    for (const name of [{}, 'a'.repeat(61), 'ab']) {
        const invalidName = await context.request.patch(`${base}/api/profile`, { headers: { Origin: base }, data: { name } });
        assert.equal(invalidName.status(), 400);
        assert.match((await invalidName.json()).message, /nome válido/);
    }
    const longestName = await context.request.patch(`${base}/api/profile`, { headers: { Origin: base }, data: { name: 'a'.repeat(60) } });
    assert.equal(longestName.status(), 200);
    assert.equal((await longestName.json()).profile.nome.length, 60);
    assert.equal((await context.request.patch(`${base}/api/profile`, { headers: { Origin: base }, data: { name: student.nome } })).status(), 200);

    await page.goto(`${base}/pedidos.html`);
    await page.waitForURL(`${base}/pages/pagina-inicial.html`);
    await page.goto(`${base}/pedidos`);
    await page.locator('#loanDuration').waitFor();
    assert.equal(await page.locator('#reservationStart, #reservationEnd').count(), 0);
    await page.getByText('Após a aprovação, você tem até 10 dias corridos', { exact: false }).waitFor();
    await page.goto(`${base}/pages/pagina-inicial.html`);
    const added = page.waitForResponse(response => response.url().endsWith('/api/carrinho/itens') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Adicionar ao carrinho' }).click();
    const addedResponse = await added;
    assert.equal(addedResponse.status(), 201, await addedResponse.text());
    await page.goto(`${base}/pedidos`);
    await page.locator('#cartItems .table-row').waitFor();
    const checkoutArtifacts = join(tmpdir(), 'chip-smoke-artifacts');
    await mkdir(checkoutArtifacts, { recursive: true });
    await page.screenshot({ path: join(checkoutArtifacts, 'checkout-pickup.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Carrinho deve caber na tela do celular');
    await page.screenshot({ path: join(checkoutArtifacts, 'checkout-pickup-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const beforeInvalidCheckout = (await db`SELECT estoque_total FROM produto WHERE id_produto = ${product.id_produto}`)[0].estoque_total;
    const invalidCheckout = await context.request.post(`${base}/api/pedidos`, {
        headers: { Origin: base }, data: { acceptedTerms: true, termsVersion: CURRENT_TERMS_VERSION, reservationStart: '2026-10-23', reservationEnd: '2026-10-30', durationDays: 7 }
    });
    assert.equal(invalidCheckout.status(), 400);
    assert.match((await invalidCheckout.json()).message, /agendamento por datas foi removido/);
    assert.equal((await db`SELECT estoque_total FROM produto WHERE id_produto = ${product.id_produto}`)[0].estoque_total, beforeInvalidCheckout);
    for (const termsVersion of [undefined, 1, 2]) {
        const staleTerms = await context.request.post(`${base}/api/pedidos`, { headers: { Origin: base }, data: { acceptedTerms: true, termsVersion, durationDays: 7 } });
        assert.equal(staleTerms.status(), 400);
        assert.match((await staleTerms.json()).message, /termo.*atualizado/i);
    }
    assert.equal((await db`SELECT estoque_total FROM produto WHERE id_produto = ${product.id_produto}`)[0].estoque_total, beforeInvalidCheckout);
    await page.locator('#acceptTerms').check();
    await page.evaluate(() => document.getElementById('modalTermos').dataset.termsVersion = '1');
    const staleNotice = page.waitForEvent('dialog').then(async dialog => { assert.match(dialog.message(), /termo.*atualizado/i); await dialog.accept(); });
    const staleRequest = page.waitForResponse(response => response.url().endsWith('/api/pedidos') && response.request().method() === 'POST');
    await page.locator('#checkoutButton').click();
    assert.equal((await staleRequest).status(), 400);
    await staleNotice;
    await page.evaluate(version => document.getElementById('modalTermos').dataset.termsVersion = String(version), CURRENT_TERMS_VERSION);

    const checkoutNotice = page.waitForEvent('dialog').then(async dialog => {
        const message = dialog.message();
        await dialog.accept();
        assert.equal(message, 'Pedido enviado para aprovação.');
    });
    const checkout = page.waitForResponse(response => response.url().endsWith('/api/pedidos') && response.request().method() === 'POST');
    await page.locator('#checkoutButton').click();
    const checkoutResponse = await checkout;
    assert.equal(checkoutResponse.status(), 201);
    const submittedOrder = (await checkoutResponse.json()).pedido;
    await checkoutNotice;
    const acceptConfirmation = dialog => dialog.accept().catch(error => errors.push(error.message));
    page.on('dialog', acceptConfirmation);
    await db`UPDATE usuario SET nivel_acesso = 2 WHERE id_usuario = ${tech.id_usuario}`;
    await context.addCookies([cookieFor(tech)]);
    await page.goto(`${base}/pedidos.html`);
    const card = () => page.getByRole('button', { name: new RegExp(`Pedido #${order.id_pedido},`) });
    await card().waitFor();
    const approved = page.getByRole('region', { name: 'Aprovado', exact: true });
    const moved = page.waitForResponse(response => response.url().endsWith(`/api/gestao/pedidos/${order.id_pedido}`) && response.request().method() === 'PATCH');
    await card().dragTo(approved);
    assert.equal((await moved).status(), 200);
    await approved.getByRole('button', { name: new RegExp(`Pedido #${order.id_pedido}, Aprovado`) }).waitFor();
    await card().focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Iniciar separação' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Cancelar pedido', exact: true }).count(), 0);
    const separated = page.waitForResponse(response => response.url().endsWith(`/api/gestao/pedidos/${order.id_pedido}`) && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Iniciar separação' }).click();
    assert.equal((await separated).status(), 200);
    await page.getByRole('button', { name: new RegExp(`Pedido #${order.id_pedido}, Em separação`) }).waitFor();
    await card().click();
    await page.getByRole('button', { name: 'Marcar para retirada' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Cancelar pedido', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    assert.equal((await db`SELECT estoque_total FROM produto WHERE id_produto = ${product.id_produto}`)[0].estoque_total, 2);
    assert.ok((await db`SELECT count(*)::int AS n FROM log_auditoria WHERE acao = 'pedido:approve'`)[0].n >= 2);
    const artifacts = join(tmpdir(), 'chip-smoke-artifacts');
    await mkdir(artifacts, { recursive: true });
    console.log(`Capturas: ${artifacts}`);
    await page.screenshot({ path: join(artifacts, 'kanban.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(artifacts, 'kanban-mobile.png'), fullPage: true });
    const foreignCancellation = await context.request.post(`${base}/api/pedidos/${submittedOrder.id_pedido}/cancelar`, { headers: { Origin: base } });
    assert.equal(foreignCancellation.status(), 404);
    const managementCancellation = await context.request.patch(`${base}/api/gestao/pedidos/${submittedOrder.id_pedido}`, {
        headers: { Origin: base }, data: { action: 'cancel' }
    });
    assert.equal(managementCancellation.status(), 400);
    assert.match((await managementCancellation.json()).message, /Somente o solicitante pode cancelar/);
    for (const reason of ['', '   ']) {
        const emptyDenial = await context.request.patch(`${base}/api/gestao/pedidos/${submittedOrder.id_pedido}`, {
            headers: { Origin: base }, data: { action: 'deny', reason }
        });
        assert.equal(emptyDenial.status(), 400);
        assert.match((await emptyDenial.json()).message, /justificativa/);
    }
    const [pendingState] = await db`
        SELECT status_pedido.descricao_status AS status, pedido.motivo_recusa
        FROM pedido JOIN status_pedido ON status_pedido.id_status = pedido.id_status
        WHERE pedido.id_pedido = ${submittedOrder.id_pedido}
    `;
    assert.deepEqual(pendingState, { status: 'Pendente', motivo_recusa: null });
    assert.equal((await db`SELECT estoque_total FROM produto WHERE id_produto = ${product.id_produto}`)[0].estoque_total, 2);
    await page.getByRole('button', { name: new RegExp(`Pedido #${submittedOrder.id_pedido}, Pendente`) }).click();
    await page.getByRole('button', { name: 'Aprovar pedido' }).waitFor();
    assert.deepEqual(await page.locator('#modalActions button').allTextContents(), ['Aprovar pedido', 'Negar pedido']);
    assert.equal(await page.getByRole('button', { name: 'Cancelar pedido', exact: true }).count(), 0);
    const refusalReason = '<b data-injected="yes">Item reservado para manutenção.</b><img src=x onerror="window.profileXss=true">';
    page.off('dialog', acceptConfirmation);
    const refusalPrompt = page.waitForEvent('dialog').then(async dialog => {
        assert.equal(dialog.type(), 'prompt');
        await dialog.accept(`  ${refusalReason}  `);
    });
    const denied = page.waitForResponse(response => response.url().endsWith(`/api/gestao/pedidos/${submittedOrder.id_pedido}`) && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Negar pedido' }).click();
    await refusalPrompt;
    assert.equal((await denied).status(), 200);
    page.on('dialog', acceptConfirmation);
    await page.getByRole('button', { name: new RegExp(`Pedido #${submittedOrder.id_pedido}, Negado`) }).waitFor();
    assert.equal((await db`SELECT motivo_recusa FROM pedido WHERE id_pedido = ${submittedOrder.id_pedido}`)[0].motivo_recusa, refusalReason);
    assert.equal((await db`SELECT estoque_total FROM produto WHERE id_produto = ${product.id_produto}`)[0].estoque_total, 3);
    const repeatedDenial = await context.request.patch(`${base}/api/gestao/pedidos/${submittedOrder.id_pedido}`, {
        headers: { Origin: base }, data: { action: 'deny', reason: refusalReason }
    });
    assert.equal(repeatedDenial.status(), 400);
    assert.equal((await db`SELECT estoque_total FROM produto WHERE id_produto = ${product.id_produto}`)[0].estoque_total, 3);
    const archiveResponse = await context.request.delete(`${base}/api/produtos/${returnProduct.id_produto}`, { headers: { Origin: base } });
    assert.equal(archiveResponse.status(), 200);
    assert.match((await archiveResponse.json()).message, /arquivado/);
    assert.equal((await getProductById(returnProduct.id_produto)).status_produto, 'Arquivado');
    assert.equal((await db`SELECT count(*)::int AS total FROM contem_lista WHERE id_pedido = ${returnOrder.id_pedido}`)[0].total, 1);
    assert.equal((await db`SELECT count(*)::int AS total FROM categorizar WHERE id_produto = ${returnProduct.id_produto}`)[0].total, 1);
    const outdatedReturn = await context.request.patch(`${base}/api/gestao/pedidos/${returnOrder.id_pedido}`, {
        headers: { Origin: base }, data: { action: 'register_return', returnItems: [{ productId: returnProduct.id_produto, quantityReturned: 1, quantityDamaged: 0 }] }
    });
    assert.equal(outdatedReturn.status(), 400);
    assert.match((await outdatedReturn.json()).message, /Confira as quantidades/);
    assert.equal((await getProductById(returnProduct.id_produto)).estoque_total, 2);
    await page.reload();
    await page.getByRole('button', { name: new RegExp(`Pedido #${returnOrder.id_pedido}, Retirado`) }).click();
    await page.getByRole('button', { name: 'Registrar devolução', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Confirmar devolução', exact: true }).isEnabled(), false);
    await page.locator('#returnItems [name="quantity"]').fill('2');
    await page.locator('#returnItems [name="damagedQuantity"]').fill('1');
    const returnNote = 'Uma unidade com conector danificado <script>alert(1)</script>.';
    await page.locator('#returnNotes').fill(returnNote);
    const partialReturn = page.waitForResponse(response => response.url().endsWith(`/api/gestao/pedidos/${returnOrder.id_pedido}`) && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Confirmar devolução', exact: true }).click();
    const partialResponse = await partialReturn;
    assert.equal(partialResponse.status(), 200);
    const partial = (await partialResponse.json()).pedido;
    assert.equal(partial.status, 'Retirado');
    assert.equal(partial.data_devolucao, null);
    assert.equal(partial.itens[0].qnt_devolvida, 2);
    assert.equal(partial.itens[0].qnt_danificada, 1);
    assert.equal(partial.devolucoes[0].observacao, returnNote);
    assert.equal((await getProductById(returnProduct.id_produto)).estoque_total, 3);
    assert.equal((await getProductById(returnProduct.id_produto)).status_produto, 'Arquivado');
    const excessiveReturn = await context.request.patch(`${base}/api/gestao/pedidos/${returnOrder.id_pedido}`, {
        headers: { Origin: base }, data: { action: 'register_return', returnItems: [{ productId: returnProduct.id_produto, quantity: 2, damagedQuantity: 0, expectedReturned: 2 }] }
    });
    assert.equal(excessiveReturn.status(), 400);
    assert.equal((await getProductById(returnProduct.id_produto)).estoque_total, 3);
    await page.getByRole('button', { name: new RegExp(`Pedido #${returnOrder.id_pedido}, Retirado`) }).click();
    await page.getByText(returnNote, { exact: true }).waitFor();
    assert.equal(await page.locator('#returnLog script').count(), 0);
    await page.getByRole('button', { name: 'Registrar devolução', exact: true }).click();
    await page.locator('#returnItems [name="quantity"]').fill('1');
    const finalReturn = page.waitForResponse(response => response.url().endsWith(`/api/gestao/pedidos/${returnOrder.id_pedido}`) && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Confirmar devolução', exact: true }).click();
    const finalReturnResponse = await finalReturn;
    assert.equal(finalReturnResponse.status(), 200);
    const completedReturn = (await finalReturnResponse.json()).pedido;
    assert.equal(completedReturn.status, 'Devolvido');
    assert.ok(completedReturn.data_devolucao);
    assert.equal(completedReturn.itens[0].qnt_devolvida, 3);
    assert.equal(completedReturn.itens[0].qnt_danificada, 1);
    const archivedAfterReturn = await getProductById(returnProduct.id_produto);
    assert.equal(archivedAfterReturn.estoque_total, 4);
    assert.equal(archivedAfterReturn.status_produto, 'Arquivado');
    const repeatedReturn = await context.request.patch(`${base}/api/gestao/pedidos/${returnOrder.id_pedido}`, {
        headers: { Origin: base }, data: { action: 'register_return' }
    });
    assert.equal(repeatedReturn.status(), 400);
    assert.equal((await getProductById(returnProduct.id_produto)).estoque_total, 4);
    const returnAudit = await db`SELECT dados_anteriores, dados_posteriores FROM log_auditoria WHERE acao = 'pedido:register_return' AND dados_posteriores::jsonb ->> 'id_pedido' = ${String(returnOrder.id_pedido)} ORDER BY id_log`;
    assert.equal(returnAudit.length, 2);
    assert.equal(JSON.parse(returnAudit[0].dados_anteriores).status, 'Retirado');
    assert.equal(JSON.parse(returnAudit[0].dados_posteriores).status, 'Retirado');
    assert.equal(JSON.parse(returnAudit[1].dados_posteriores).status, 'Devolvido');
    await context.addCookies([cookieFor(student)]);
    await page.goto(`${base}/pedidos`);
    await page.locator('#orderHistory').getByRole('button').filter({ hasText: `Pedido #${submittedOrder.id_pedido}` }).click();
    assert.equal(await page.locator('#modalStatus').textContent(), 'Negado');
    assert.equal(await page.locator('#modalReason').textContent(), `Justificativa de recusa: ${refusalReason}`);
    assert.equal(await page.getByRole('button', { name: 'Cancelar solicitação', exact: true }).count(), 0);
    await page.goto(`${base}/perfil`);
    await page.getByText(refusalReason, { exact: true }).waitFor();
    assert.equal(await page.locator('.order-text').filter({ hasText: refusalReason }).textContent(), refusalReason);
    assert.equal(await page.locator('[data-injected], .order-text img').count(), 0);
    assert.equal(await page.evaluate(() => window.profileXss), undefined);
    const copiedToken = cookieFor(student).value;
    const logoutHeaders = { Origin: base, Authorization: `Bearer ${copiedToken}` };
    for (const headers of [{ Origin: base }, { Origin: base, Authorization: 'Bearer invalid' }]) {
        assert.equal((await fetch(`${base}/api/logout`, { method: 'POST', headers })).status, 200);
    }
    assert.equal((await fetch(`${base}/api/logout`, { method: 'POST', headers: logoutHeaders })).status, 200);
    assert.equal((await db`SELECT session_version FROM usuario WHERE id_usuario = ${student.id_usuario}`)[0].session_version, 1);
    assert.equal((await fetch(`${base}/api/profile`, { headers: logoutHeaders })).status, 403);
    assert.equal((await fetch(`${base}/api/session`, { headers: logoutHeaders }).then(response => response.json())).user, null);
    const revokedPage = await fetch(`${base}/perfil`, { headers: logoutHeaders, redirect: 'manual' });
    assert.equal(revokedPage.headers.get('location'), '/login');
    assert.equal((await fetch(`${base}/api/logout`, { method: 'POST', headers: logoutHeaders })).status, 200);
    assert.equal((await db`SELECT session_version FROM usuario WHERE id_usuario = ${student.id_usuario}`)[0].session_version, 1);
    const freshStudent = await upsertGoogleUserProfile({ sub: 'student', email: student.email, name: student.nome });
    const freshHeaders = { Cookie: `authcookie=${cookieFor(freshStudent).value}`, Origin: base };
    assert.equal((await fetch(`${base}/api/profile`, { headers: freshHeaders })).status, 200);
    await db`UPDATE usuario SET status_conta = false WHERE id_usuario = ${student.id_usuario}`;
    assert.equal((await fetch(`${base}/api/logout`, { method: 'POST', headers: freshHeaders })).status, 200);
    await db`UPDATE usuario SET status_conta = true WHERE id_usuario = ${student.id_usuario}`;
    assert.equal((await fetch(`${base}/api/profile`, { headers: freshHeaders })).status, 403);
    assert.equal((await db`SELECT session_version FROM usuario WHERE id_usuario = ${student.id_usuario}`)[0].session_version, 2);
    assert.deepEqual(errors, []);
    await run('scripts/apply-migration.mjs', { DATABASE_URL: urls[0] }, ['database/migrations/session_version.sql']);
    assert.equal((await db`SELECT session_version FROM usuario WHERE id_usuario = ${student.id_usuario}`)[0].session_version, 2);
    await db`ALTER TABLE usuario DROP COLUMN session_version`;
    const expectedOrderCount = (await db`SELECT count(*)::int AS n FROM pedido`)[0].n;
    await run('scripts/copy-local-database.mjs', { SOURCE_DATABASE_URL: urls[0], DATABASE_URL: urls[1] });
    assert.equal((await target`SELECT count(*)::int AS n FROM pedido`)[0].n, expectedOrderCount);
    assert.equal((await target`SELECT estoque_total FROM produto WHERE id_produto = ${product.id_produto}`)[0].estoque_total, 3);
    assert.equal((await target`SELECT motivo_recusa FROM pedido WHERE id_pedido = ${submittedOrder.id_pedido}`)[0].motivo_recusa, refusalReason);
    assert.equal((await target`SELECT session_version FROM usuario WHERE id_usuario = ${student.id_usuario}`)[0].session_version, 0);
    await assert.rejects(run('scripts/copy-local-database.mjs', { SOURCE_DATABASE_URL: urls[0], DATABASE_URL: urls[1] }), /Destino não está vazio/);
    await db`UPDATE pedido SET data_aprovacao = NULL WHERE id_pedido = ${order.id_pedido}`;
    await run('scripts/apply-migration.mjs', { DATABASE_URL: urls[0] }, ['database/migrations/pickup_deadline.sql']);
    assert.equal((await db`SELECT data_aprovacao = current_date AS backfilled FROM pedido WHERE id_pedido = ${order.id_pedido}`)[0].backfilled, true);
    const migrationPaths = ['database/schema.sql', ...['google_login', 'reservations', 'google_only', 'indexes', 'session_version', 'pickup_deadline', 'return_conditions', 'loan_renewals', 'user_management', 'notifications', 'inventory_usage'].map(file => `database/migrations/${file}.sql`)];
    await run('scripts/apply-migration.mjs', { DATABASE_URL: urls[0] }, migrationPaths);
    assert.equal((await db`SELECT count(*)::int AS n FROM pedido`)[0].n, expectedOrderCount);
    assert.equal((await db`SELECT estoque_total FROM produto WHERE id_produto = ${product.id_produto}`)[0].estoque_total, 3);
    assert.equal((await db`SELECT motivo_recusa FROM pedido WHERE id_pedido = ${submittedOrder.id_pedido}`)[0].motivo_recusa, refusalReason);
    assert.equal((await db`SELECT session_version FROM usuario WHERE id_usuario = ${student.id_usuario}`)[0].session_version, 0);
    console.log('OK: schema, migrações, vínculo Google, retirada/cancelamento próprio/expiração/estoque, catálogo público, permissões e paths alternativos, termo exibido e versão antiga recusada, nome validado, devoluções parciais/danos/ocorrências sem duplicar estoque, arquivamento com histórico, checkout sem agendamento, prazo de dez dias, expiração concorrente sem duplicar estoque, Kanban por arraste e teclado, negativa com justificativa, privacidade do CPF, cache privado, logout com revogação, cópia de schema antigo.');
} finally {
    if (browser) await browser.close();
    if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    if (db) await db.end();
    if (target) await target.end();
    for (const name of created.reverse()) await admin`DROP DATABASE ${admin(name)}`;
    await admin.end();
}
