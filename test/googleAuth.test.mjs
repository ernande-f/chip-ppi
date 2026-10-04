import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
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
