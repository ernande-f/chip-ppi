import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { completeGoogleLogin, startGoogleLogin, validateGoogleIdentity } from '../backend/services/googleAuth.js';

test('OAuth verifica state, nonce, assinatura, audiência e vínculo institucional', async (t) => {
    const domains = ['aluno.iffar.edu.br', 'iffarroupilha.edu.br'];
    const claims = { sub: 'google-123', email: 'aluno@aluno.iffar.edu.br', hd: domains[0], email_verified: true, nonce: 'nonce', name: 'Aluno' };
    assert.equal(validateGoogleIdentity(claims, 'nonce', domains).email, claims.email);
    for (const invalid of [{ email_verified: false }, { hd: 'gmail.com' }, { hd: undefined }, { email: 'user@aluno.iffar.edu.br.evil.test' }, { nonce: 'other' }, { sub: '' }]) {
        assert.throws(() => validateGoogleIdentity({ ...claims, ...invalid }, 'nonce', domains));
    }
    const previousEnv = { ...process.env };
    t.after(() => { process.env = previousEnv; });
    Object.assign(process.env, { GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_ALLOWED_DOMAINS: domains.join(','), APP_URL: 'http://localhost:3000', APP_SESSION_SECRET: 'test-secret-with-at-least-32-characters' });
    let cookie, url;
    const res = { cookie(name, value, options) { cookie = value; assert.equal(options.sameSite, 'lax'); }, set() {}, redirect(value) { url = new URL(value); }, clearCookie() {} };
    startGoogleLogin(res);
    const nonce = url.searchParams.get('nonce');
    const state = url.searchParams.get('state');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig' };
    let audience = 'client';
    t.mock.method(globalThis, 'fetch', async (endpoint) => {
        if (endpoint.endsWith('/token')) {
            const id_token = jwt.sign({ ...claims, nonce }, privateKey, { algorithm: 'RS256', keyid: 'test-key', issuer: 'https://accounts.google.com', audience, expiresIn: 60 });
            return Response.json({ id_token });
        }
        return Response.json({ keys: [jwk] });
    });
    const req = { cookies: { google_login: cookie }, query: { state, code: 'auth-code' } };
    assert.equal((await completeGoogleLogin(req, res)).sub, claims.sub);
    await assert.rejects(completeGoogleLogin({ ...req, query: { state: 'forged', code: 'code' } }, res));
    audience = 'other-client';
    await assert.rejects(completeGoogleLogin(req, res));
    audience = 'client';
    jwk.n = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'jwk' }).n;
    await assert.rejects(completeGoogleLogin(req, res));
});

function signingKey(kid = 'test-key') {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return { privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig' } };
}

async function oauthFixture(t) {
    const previousEnv = { ...process.env };
    t.after(() => { process.env = previousEnv; });
    Object.assign(process.env, {
        GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_ALLOWED_DOMAINS: 'aluno.iffar.edu.br',
        APP_URL: 'http://localhost:3000', APP_SESSION_SECRET: 'test-secret-with-at-least-32-characters'
    });
    const auth = await import(`../backend/services/googleAuth.js?test=${randomUUID()}`);
    const fixture = { key: signingKey() };
    let cookie, url;
    const res = { cookie(name, value) { cookie = value; }, set() {}, redirect(value) { url = new URL(value); }, clearCookie() {} };
    fixture.login = () => {
        auth.startGoogleLogin(res);
        return auth.completeGoogleLogin({ cookies: { google_login: cookie }, query: { state: url.searchParams.get('state'), code: 'auth-code' } }, res);
    };
    fixture.tokenResponse = () => Response.json({
        id_token: jwt.sign({
            sub: 'google-123', email: 'aluno@aluno.iffar.edu.br', hd: 'aluno.iffar.edu.br',
            email_verified: true, nonce: url.searchParams.get('nonce')
        }, fixture.key.privateKey, { algorithm: 'RS256', keyid: fixture.key.jwk.kid, issuer: 'https://accounts.google.com', audience: 'client', expiresIn: 60 })
    });
    return fixture;
}

test('relogins reutilizam certificados até max-age menos Age e renovam ao expirar', async (t) => {
    const oauth = await oauthFixture(t);
    let now = Date.now(), certificates = 0, tokens = 0;
    t.mock.method(Date, 'now', () => now);
    t.mock.method(globalThis, 'fetch', async (endpoint) => {
        if (endpoint.endsWith('/token')) { tokens++; return oauth.tokenResponse(); }
        certificates++;
        return Response.json({ keys: [oauth.key.jwk] }, { headers: { 'Cache-Control': 'public, max-age=60', Age: '30' } });
    });
    assert.equal((await oauth.login()).sub, 'google-123');
    now += 29_999;
    assert.equal((await oauth.login()).sub, 'google-123');
    assert.equal(certificates, 1);
    now++;
    assert.equal((await oauth.login()).sub, 'google-123');
    assert.equal(certificates, 2);
    assert.equal(tokens, 3);
});

for (const directive of ['no-store', 'no-cache']) {
    test(`certificados com ${directive} não são reutilizados`, async (t) => {
        const oauth = await oauthFixture(t);
        let certificates = 0;
        t.mock.method(globalThis, 'fetch', async (endpoint) => {
            if (endpoint.endsWith('/token')) return oauth.tokenResponse();
            certificates++;
            return Response.json({ keys: [oauth.key.jwk] }, { headers: { 'Cache-Control': `max-age=3600, ${directive}` } });
        });
        await oauth.login();
        await oauth.login();
        assert.equal(certificates, 2);
    });
}

test('rotação da chave Google renova certificados mesmo com cache vigente', async (t) => {
    const oauth = await oauthFixture(t);
    let certificates = 0;
    t.mock.method(globalThis, 'fetch', async (endpoint) => {
        if (endpoint.endsWith('/token')) return oauth.tokenResponse();
        certificates++;
        return Response.json({ keys: [oauth.key.jwk] }, { headers: { 'Cache-Control': 'max-age=3600' } });
    });
    await oauth.login();
    oauth.key = signingKey('rotated-key');
    assert.equal((await oauth.login()).sub, 'google-123');
    await oauth.login();
    assert.equal(certificates, 2);
});

for (const stage of ['token', 'certs']) {
    test(`timeout em ${stage} preserva diagnóstico, usa 20s e não repete código OAuth`, async (t) => {
        const oauth = await oauthFixture(t);
        const timeouts = [], calls = [];
        t.mock.method(AbortSignal, 'timeout', duration => { timeouts.push(duration); return new AbortController().signal; });
        const failure = Object.assign(new DOMException('Timeout de teste', 'TimeoutError'), { cause: Object.assign(new Error('DNS de teste'), { code: 'ENOTFOUND' }) });
        t.mock.method(globalThis, 'fetch', async (endpoint) => {
            const current = endpoint.endsWith('/token') ? 'token' : 'certs';
            calls.push(current);
            if (current === stage) throw failure;
            return oauth.tokenResponse();
        });
        await assert.rejects(oauth.login(), error => {
            assert.equal(error.googleStage, stage);
            assert.equal(error.name, 'TimeoutError');
            assert.equal(error.cause, failure.cause);
            return true;
        });
        assert.deepEqual(calls, stage === 'token' ? ['token'] : ['token', 'certs']);
        assert.deepEqual(timeouts, calls.map(() => 20_000));
    });
}

test('falha ao buscar certificados não é armazenada e o próximo login pode concluir', async (t) => {
    const oauth = await oauthFixture(t);
    let certificates = 0, tokens = 0;
    t.mock.method(globalThis, 'fetch', async (endpoint) => {
        if (endpoint.endsWith('/token')) { tokens++; return oauth.tokenResponse(); }
        certificates++;
        if (certificates === 1) throw new TypeError('Falha de rede de teste');
        return Response.json({ keys: [oauth.key.jwk] }, { headers: { 'Cache-Control': 'max-age=3600' } });
    });
    await assert.rejects(oauth.login(), error => error.googleStage === 'certs' && error.name === 'TypeError');
    assert.equal((await oauth.login()).sub, 'google-123');
    assert.equal((await oauth.login()).sub, 'google-123');
    assert.equal(certificates, 2);
    assert.equal(tokens, 3);
});
