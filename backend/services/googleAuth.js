import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getSessionSecret } from './sessionAuth.js';
import { getGoogleConfig } from '../config.js';

const COOKIE = 'google_login';
const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/auth/google' });

export function startGoogleLogin(res) {
    const { clientId, domains, redirectUri } = getGoogleConfig();
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const flow = jwt.sign({ state, nonce, verifier }, getSessionSecret(), { algorithm: 'HS256', expiresIn: '10m', audience: 'google-login', issuer: 'chip-ppi' });
    res.cookie(COOKIE, flow, { ...cookieOptions(), maxAge: 600_000 });
    const params = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
        state, nonce, prompt: 'select_account',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256'
    });
    if (domains.length === 1) params.set('hd', domains[0]);
    res.set('Cache-Control', 'no-store');
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

export function validateGoogleIdentity(claims, nonce, domains) {
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    const domain = email.split('@');
    if (claims.nonce !== nonce || !nonce || claims.email_verified !== true ||
        typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 ||
        domain.length !== 2 || !domain[0] || /\s/.test(email) || email.length > 320 ||
        !domains.includes(domain[1]) || !domains.includes(claims.hd)) {
        throw new Error('Use uma conta Google institucional verificada.');
    }
    return { sub: claims.sub, email, name: typeof claims.name === 'string' ? claims.name.slice(0, 60) : domain[0].slice(0, 60) };
}

export async function completeGoogleLogin(req, res) {
    res.clearCookie(COOKIE, cookieOptions());
    const { clientId, clientSecret, redirectUri, domains } = getGoogleConfig();
    const flow = jwt.verify(req.cookies?.[COOKIE], getSessionSecret(), { algorithms: ['HS256'], audience: 'google-login', issuer: 'chip-ppi' });
    if (typeof req.query.state !== 'string' || req.query.state !== flow.state || typeof req.query.code !== 'string' || req.query.error) {
        throw new Error('Retorno OAuth inválido.');
    }
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({ code: req.query.code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: flow.verifier })
    });
    if (!response.ok) throw new Error('Google recusou a autenticação.');
    const { id_token: token } = await response.json();
    const header = jwt.decode(token, { complete: true })?.header;
    if (header?.alg !== 'RS256' || !header.kid) throw new Error('Token Google inválido.');
    const keysResponse = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(10_000) });
    if (!keysResponse.ok) throw new Error('Não foi possível validar a assinatura Google.');
    const { keys } = await keysResponse.json();
    const key = keys.find(key => key.kid === header.kid && key.kty === 'RSA' && key.use === 'sig');
    if (!key) throw new Error('Assinatura Google desconhecida.');
    const claims = jwt.verify(token, createPublicKey({ key, format: 'jwk' }), {
        algorithms: ['RS256'], audience: clientId, issuer: ['https://accounts.google.com', 'accounts.google.com']
    });
    if (!Number.isFinite(claims.exp) || (claims.azp && claims.azp !== clientId)) throw new Error('Token Google inválido.');
    return validateGoogleIdentity(claims, flow.nonce, domains);
}
