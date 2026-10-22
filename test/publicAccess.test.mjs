import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function startServer(t, env = {}) {
    const child = spawn(process.execPath, ['backend/server.js'], {
        env: { ...process.env, PORT: '0', NODE_ENV: 'test', TRUST_PROXY: 'false', GLOBAL_RATE_LIMIT_MAX: '500', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test', APP_URL: 'http://localhost:3000', APP_SESSION_SECRET: 'test-secret-at-least-32-characters', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_ALLOWED_DOMAINS: 'aluno.iffar.edu.br,iffarroupilha.edu.br', ...env },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
    return new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`Servidor terminou: ${code}`)));
        child.stdout.on('data', data => { const match = String(data).match(/http:\/\/localhost:\d+/); if (match) resolve(match[0]); });
        child.stderr.on('data', data => reject(new Error(String(data))));
    });
}

test('catálogo público, APIs privadas protegidas e senha desativada', { timeout: 15_000 }, async (t) => {
    const base = await startServer(t);
    for (const page of ['/', '/pages/pagina-inicial.html', '/login']) {
        const response = await fetch(`${base}${page}`);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /Catálogo do laboratório|Entrar com Google/);
    }
    const session = await fetch(`${base}/api/session`).then(response => response.json());
    assert.equal(session.user, null);
    const local = await fetch(`${base}/login`);
    assert.equal(local.headers.get('strict-transport-security'), null);
    assert.doesNotMatch(local.headers.get('content-security-policy'), /upgrade-insecure-requests/);
    assert.match(local.headers.get('content-security-policy'), /script-src 'self';/);
    assert.equal(local.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${base}/api/health`)).status, 503);
    for (const api of ['/api/carrinho', '/api/pedidos', '/api/gestao/pedidos', '/api/profile']) {
        const response = await fetch(`${base}${api}`);
        assert.equal(response.status, 401);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.match(response.headers.get('vary'), /Cookie/);
    }
    for (const page of ['/pedidos.html', '/pages/pedidos.html', '/register', '/pages/nova-senha.html']) {
        const response = await fetch(`${base}${page}`, { redirect: 'manual' });
        assert.equal(response.headers.get('location'), '/login');
    }
    assert.equal((await fetch(`${base}/api/register`, { method: 'POST', headers: { Origin: 'http://localhost:3000' } })).status, 410);
    const login = await fetch(`${base}/api/auth/google`, { redirect: 'manual' });
    assert.equal(login.status, 302);
    assert.match(login.headers.get('location'), /^https:\/\/accounts.google.com\//);
    const invalidCallback = await fetch(`${base}/api/auth/google/callback?state=forged&code=fake`, { redirect: 'manual' });
    assert.equal(invalidCallback.headers.get('location'), '/login?error=google');
});

test('HTML protegido exige sessão por caminhos alternativos e HEAD', { timeout: 15_000 }, async (t) => {
    const base = await startServer(t);
    for (const method of ['GET', 'HEAD']) {
        for (const page of ['/pages/perfil.html', '/pages/perfil%2Ehtml', '/pages/perfil%2e%68%74%6d%6c', '/pages/perfil.HTML', '/PAGES/PEDIDOS.HTML', '/pages%2fpedidos.html', '/pages/%2e%2e/pages/pedidos.html', '/pages%5cpedidos.html']) {
            const response = await fetch(`${base}${page}`, { method, redirect: 'manual' });
            assert.equal(response.status, 302, `${method} ${page}`);
            assert.equal(response.headers.get('location'), '/login');
            assert.equal(response.headers.get('cache-control'), 'no-store');
        }
    }
    for (const page of ['/pages/perfil%ZZhtml', '/pages/perfil%00.html']) {
        assert.equal((await fetch(`${base}${page}`)).status, 400);
    }
    const publicPage = await fetch(`${base}/pages/pagina-inicial%2Ehtml`);
    assert.equal(publicPage.status, 200);
});

test('arquivos estáticos não gastam o limite da API', { timeout: 15_000 }, async (t) => {
    const base = await startServer(t, { GLOBAL_RATE_LIMIT_MAX: '2' });
    for (let index = 0; index < 3; index++) {
        assert.equal((await fetch(`${base}/js/api.js`)).status, 200);
        assert.equal((await fetch(`${base}/login`)).status, 200);
    }
    for (let index = 0; index < 2; index++) assert.equal((await fetch(`${base}/api/session`)).status, 200);
    const limited = await fetch(`${base}/api/session`);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${base}/js/api.js`)).status, 200);
});

test('uma turma com 50 logins no mesmo IP não esgota o limite com os callbacks', { timeout: 15_000 }, async (t) => {
    const base = await startServer(t, { AUTH_RATE_LIMIT_MAX: '' });
    for (let index = 0; index < 50; index++) {
        assert.equal((await fetch(`${base}/api/auth/google`, { redirect: 'manual' })).status, 302);
        const callback = await fetch(`${base}/api/auth/google/callback?state=invalid&code=invalid`, { redirect: 'manual' });
        assert.equal(callback.status, 302);
    }
    for (let index = 50; index < 100; index++) {
        assert.equal((await fetch(`${base}/api/auth/google`, { redirect: 'manual' })).status, 302);
    }
    assert.equal((await fetch(`${base}/api/auth/google`, { redirect: 'manual' })).status, 429);
    assert.equal((await fetch(`${base}/api/auth/google/callback?state=invalid&code=invalid`, { redirect: 'manual' })).status, 302);
    assert.equal((await fetch(`${base}/api/session`)).status, 200);
});

test('o limite de início de login configurado continua sendo aplicado', { timeout: 15_000 }, async (t) => {
    const base = await startServer(t, { AUTH_RATE_LIMIT_MAX: '2' });
    for (let index = 0; index < 2; index++) {
        assert.equal((await fetch(`${base}/api/auth/google`, { redirect: 'manual' })).status, 302);
        assert.equal((await fetch(`${base}/api/auth/google/callback`, { redirect: 'manual' })).status, 302);
    }
    assert.equal((await fetch(`${base}/api/auth/google`, { redirect: 'manual' })).status, 429);
});
