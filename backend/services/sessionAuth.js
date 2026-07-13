import jwt from 'jsonwebtoken';
import 'dotenv/config';

const SESSION_COOKIE = 'authcookie';
const SESSION_DURATION_SECONDS = 2 * 24 * 60 * 60;

function getSessionSecret() {
    const secret = process.env.APP_SESSION_SECRET || process.env.ACCESS_TOKEN || process.env.CRYPTO_KEY;

    if (!secret) {
        throw new Error('Defina APP_SESSION_SECRET para assinar as sessões do CHIP.');
    }

    return secret;
}

function getCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict',
        path: '/',
        maxAge: SESSION_DURATION_SECONDS * 1000
    };
}

export function createSessionToken(user) {
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
        audience: 'chip-ppi'
    });

    return {
        id: payload.sub,
        email: payload.email || null,
        user_metadata: payload.user_metadata || {},
        auth_provider: payload.auth_provider || 'supabase'
    };
}
