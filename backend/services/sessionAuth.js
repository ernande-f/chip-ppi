import jwt from 'jsonwebtoken';
import '../config.js';

const SESSION_COOKIE = 'authcookie';
const SESSION_DURATION_SECONDS = 2 * 24 * 60 * 60;

export function getSessionSecret() {
    const secret = process.env.APP_SESSION_SECRET;

    if (!secret || secret.length < 32 || /USE_UMA_|CHANGE_ME|YOUR_/.test(secret)) {
        throw new Error('Defina APP_SESSION_SECRET com pelo menos 32 caracteres para assinar as sessões do CHIP.');
    }

    return secret;
}

function getCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        path: '/',
        maxAge: SESSION_DURATION_SECONDS * 1000
    };
}

export function createSessionToken(user) {
    if (user.auth_provider !== 'google' || typeof user.id !== 'string' || !user.id) {
        throw new Error('A sessão exige uma conta autenticada com Google.');
    }

    return jwt.sign(
        {
            email: user.email || null,
            user_metadata: user.user_metadata || {},
            auth_provider: user.auth_provider
        },
        getSessionSecret(),
        {
            subject: user.id,
            expiresIn: SESSION_DURATION_SECONDS,
            issuer: 'chip-ppi',
            audience: 'chip-ppi'
        }
    );
}

export function setSessionCookie(res, user) {
    res.cookie(SESSION_COOKIE, createSessionToken(user), getCookieOptions());
}

export function clearSessionCookie(res) {
    const { maxAge, ...options } = getCookieOptions();
    res.clearCookie(SESSION_COOKIE, options);
}

export function verifySessionToken(token) {
    const payload = jwt.verify(token, getSessionSecret(), {
        issuer: 'chip-ppi',
        audience: 'chip-ppi',
        algorithms: ['HS256']
    });

    if (typeof payload.sub !== 'string' || !payload.sub || payload.auth_provider !== 'google') {
        throw new jwt.JsonWebTokenError('Entre novamente com Google.');
    }

    return {
        id: payload.sub,
        email: payload.email || null,
        user_metadata: payload.user_metadata || {},
        auth_provider: 'google'
    };
}
