import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import express from 'express';
import cookieParser from 'cookie-parser';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';

// A falha acontece antes do acesso a perfis; nenhum banco é usado neste teste.
test('callback distingue falhas de conexão sem expor credenciais no log', async (t) => {
    const previousEnv = { ...process.env };
    t.after(() => { process.env = previousEnv; });
    Object.assign(process.env, {
        DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test', APP_URL: 'http://localhost:3000',
        GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_ALLOWED_DOMAINS: 'aluno.iffar.edu.br',
        APP_SESSION_SECRET: 'test-secret-with-at-least-32-characters'
    });
    const { default: routes } = await import('../backend/routes/api.js');
    const app = express().use(cookieParser()).use('/api', routes);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = globalThis.fetch;
    const logs = [];
    t.mock.method(console, 'error', (...args) => logs.push(args));
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    let failureStage, failure, nonce;
    t.mock.method(globalThis, 'fetch', async (url) => {
        const stage = url.endsWith('/token') ? 'token' : 'certs';
        if (stage === failureStage) throw failure;
        return Response.json({ id_token: jwt.sign({ nonce }, privateKey, { algorithm: 'RS256', keyid: 'test-key' }) });
    });
    for (const [stage, name, code] of [['token', 'TimeoutError'], ['certs', 'TimeoutError'], ['token', 'TypeError', 'ENOTFOUND']]) {
        failureStage = stage;
        failure = Object.assign(new Error('sensitive-auth-code'), { name, cause: { code } });
        const start = await request(`${base}/api/auth/google`, { redirect: 'manual' });
        const authUrl = new URL(start.headers.get('location'));
        nonce = authUrl.searchParams.get('nonce');
        const callback = await request(`${base}/api/auth/google/callback?state=${authUrl.searchParams.get('state')}&code=sensitive-auth-code`, {
            redirect: 'manual', headers: { Cookie: start.headers.get('set-cookie').split(';')[0] }
        });
        assert.equal(callback.headers.get('location'), '/login?error=network');
        assert.doesNotMatch(callback.headers.get('set-cookie'), /authcookie=/);
        const details = logs.at(-1)[1];
        assert.equal(details.etapa, stage);
        assert.equal(details.tipo, name);
        assert.equal(details.codigo, code);
        assert.equal(typeof details.duracao_ms, 'number');
    }
    assert.doesNotMatch(JSON.stringify(logs), /sensitive-auth-code|test-secret|client_secret|id_token/);
});

test('login mostra erro de rede sem refletir texto da URL', async () => {
    const source = await readFile(new URL('../frontend/js/login.js', import.meta.url), 'utf8');
    for (const [search, hidden] of [['', true], ['?error=network', false], ['?error=google', false], ['?error=<img onerror=alert(1)>', false]]) {
        const notice = { textContent: 'Erro genérico' };
        runInNewContext(source, { URLSearchParams, location: { search }, document: { getElementById: () => notice } });
        assert.equal(notice.hidden, hidden);
        assert.equal(notice.textContent, search === '?error=network'
            ? 'Não foi possível conectar ao Google a tempo. Tente entrar novamente em instantes.' : 'Erro genérico');
    }
});
