import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('catálogo público, APIs privadas protegidas e senha desativada', { timeout: 15_000 }, async (t) => {
    const child = spawn(process.execPath, ['backend/server.js'], {
        env: { ...process.env, PORT: '0', NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test', APP_URL: 'http://localhost:3000', APP_SESSION_SECRET: 'test-secret-at-least-32-characters', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_ALLOWED_DOMAINS: 'aluno.iffar.edu.br,iffarroupilha.edu.br' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
    const base = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`Servidor terminou: ${code}`)));
        child.stdout.on('data', data => { const match = String(data).match(/http:\/\/localhost:\d+/); if (match) resolve(match[0]); });
        child.stderr.on('data', data => reject(new Error(String(data))));
    });
    for (const page of ['/', '/pages/pagina-inicial.html', '/login']) {
        const response = await fetch(`${base}${page}`);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /Catálogo do laboratório|Entrar com Google/);
    }
    const session = await fetch(`${base}/api/session`).then(response => response.json());
    assert.equal(session.user, null);
    for (const api of ['/api/carrinho', '/api/pedidos', '/api/gestao/pedidos', '/api/profile']) {
        assert.equal((await fetch(`${base}${api}`)).status, 401);
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
