import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import sql from '../backend/db.js';
import { createSessionToken } from '../backend/services/sessionAuth.js';

let server, browser;
const results = [];
const artifacts = await mkdtemp(join(tmpdir(), 'chip-stress-'));
try {
    assert.ok(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname), 'O teste exige banco local fora de produção.');
    const [counts] = await sql`SELECT (SELECT count(*)::int FROM produto) produtos, (SELECT count(*)::int FROM usuario) usuarios,
        (SELECT count(*)::int FROM pedido) pedidos, (SELECT count(*)::int FROM contem_lista) itens,
        (SELECT count(*)::int FROM notificacao) notificacoes, (SELECT count(*)::int FROM log_auditoria) auditoria`;
    assert.ok(counts.produtos >= 10_000 && counts.pedidos >= 30_000, 'Execute a carga de volume autorizada antes deste teste.');
    const [operator] = await sql`SELECT * FROM usuario WHERE nivel_acesso = 2 AND auth_provider = 'google' AND status_conta ORDER BY id_usuario LIMIT 1`;
    assert.ok(operator, 'Administrador institucional ausente.');
    const probe = createServer().listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const base = `http://localhost:${port}`;
    server = spawn(process.execPath, ['backend/server.js'], {
        env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), APP_URL: base, NOTIFICATION_EMAIL_ENABLED: 'false' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let log = '';
    server.stderr.on('data', chunk => { log += chunk; });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.once('exit', code => reject(new Error(`Servidor terminou (${code}): ${log}`)));
        server.stdout.on('data', chunk => { if (String(chunk).includes('Servidor rodando')) resolve(); });
    });
    const token = createSessionToken({ id: operator.auth_user_id, email: operator.email, auth_provider: 'google', session_version: operator.session_version });
    async function request(path, authenticated = false) {
        const started = performance.now();
        const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30_000), headers: authenticated ? { Cookie: `authcookie=${token}` } : {} });
        const body = await response.text();
        const measurement = { path, status: response.status, ms: Math.round(performance.now() - started), bytes: Buffer.byteLength(body) };
        results.push(measurement);
        assert.equal(response.status, 200, JSON.stringify(measurement));
        return JSON.parse(body);
    }
    await request('/api/health');
    const pages = [];
    for (let page = 1; page <= 5; page++) {
        const data = await request(`/api/produtos?availableOnly=true&page=${page}&limit=20`);
        assert.equal(data.produtos.length, 20);
        assert.equal(data.page, page);
        assert.equal(data.hasMore, true);
        pages.push(...data.produtos.map(row => row.id_produto));
    }
    assert.equal(new Set(pages).size, 100, 'Paginação repetiu produtos.');
    const catalog = await request('/api/produtos?availableOnly=true&limit=20');
    const last = await request(`/api/produtos?availableOnly=true&limit=20&page=${catalog.totalPages}`);
    assert.equal(last.hasMore, false);
    assert.equal(last.produtos.length, catalog.total % 20 || 20);
    const archived = await request('/api/produtos?status=Arquivado&includeArchived=true&page=1&limit=20', true);
    assert.equal(archived.produtos.length, 20);
    assert.ok(archived.produtos.every(row => row.status_produto === 'Arquivado'));
    assert.equal((await request('/api/gestao/usuarios?page=2', true)).usuarios.length, 20);
    await request('/api/notificacoes?page=2', true);
    const managed = await request('/api/gestao/pedidos', true);
    assert.equal(managed.pedidos.length, counts.pedidos);
    await request('/api/gestao/relatorios', true);
    const loadStart = results.length;
    let task = 0;
    await Promise.all(Array.from({ length: 10 }, async () => {
        while (task < 100) {
            const page = ++task;
            const data = await request(`/api/produtos?availableOnly=true&limit=20&page=${page}`);
            assert.equal(data.produtos.length, 20);
        }
    }));
    const load = results.slice(loadStart).map(row => row.ms).sort((a, b) => a - b);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/pages/pagina-inicial.html`);
    await page.waitForFunction(() => document.querySelectorAll('#catalogGrid .item-card').length >= 20);
    await page.locator('#catalogSentinel').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelectorAll('#catalogGrid .item-card').length >= 40);
    assert.equal(await page.locator('#catalogGrid h3').evaluateAll(nodes => new Set(nodes.map(node => node.textContent)).size), await page.locator('#catalogGrid h3').count());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: join(artifacts, 'catalogo-390.png') });
    await context.addCookies([{ name: 'authcookie', value: token, url: base }]);
    const kanbanStart = performance.now();
    await page.goto(`${base}/pedidos.html`);
    await page.waitForFunction(() => document.querySelectorAll('#ordersGrid .order-card').length === 3000, null, { timeout: 30_000 });
    const kanbanMs = Math.round(performance.now() - kanbanStart);
    assert.equal(await page.locator('#historyGrid .order-card').count(), 12);
    await page.screenshot({ path: join(artifacts, 'kanban-390.png') });
    assert.deepEqual(errors, []);
    const summary = { counts, concurrency: 10, catalogRequests: 100, catalogP50Ms: load[49], catalogP95Ms: load[94], catalogMaxMs: load.at(-1),
        kanbanMs, measurements: results, artifacts };
    await writeFile(join(artifacts, 'resultado.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ ...summary, measurements: results.slice(0, loadStart) }, null, 2));
} finally {
    await browser?.close();
    if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
    await sql.end();
}
