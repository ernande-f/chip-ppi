import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import {
    clearSessionCookie,
    createSessionToken,
    setSessionCookie,
    verifySessionToken
} from '../backend/services/sessionAuth.js';

const secret = 'session-test-secret-with-at-least-32-characters';
const user = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'aluno@aluno.iffar.edu.br',
    user_metadata: { name: 'Aluno' },
    auth_provider: 'google'
};

function configureSession(t, environment = 'test') {
    const previousSecret = process.env.APP_SESSION_SECRET;
    const previousEnvironment = process.env.NODE_ENV;
    process.env.APP_SESSION_SECRET = secret;
    process.env.NODE_ENV = environment;
    t.after(() => {
        if (previousSecret === undefined) delete process.env.APP_SESSION_SECRET;
        else process.env.APP_SESSION_SECRET = previousSecret;
        if (previousEnvironment === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousEnvironment;
    });
}

test('a sessão local identifica a conta Google autenticada', (t) => {
    configureSession(t);
    assert.deepEqual(verifySessionToken(createSessionToken(user)), user);
    assert.throws(() => createSessionToken({ ...user, auth_provider: 'ldap' }));
    assert.throws(() => createSessionToken({ ...user, id: null }));
});

test('recusa sessões antigas, adulteradas, vencidas ou destinadas a outra aplicação', (t) => {
    configureSession(t);
    const claims = { email: user.email, auth_provider: 'google' };
    const options = { subject: user.id, issuer: 'chip-ppi', audience: 'chip-ppi', expiresIn: 60 };
    for (const [payload, signingOptions, signingSecret] of [
        [{ ...claims, auth_provider: undefined }, options, secret],
        [{ ...claims, auth_provider: 'ldap' }, options, secret],
        [claims, { ...options, subject: '' }, secret],
        [claims, { ...options, issuer: 'another-app' }, secret],
        [claims, { ...options, audience: 'another-app' }, secret],
        [claims, { ...options, expiresIn: -1 }, secret],
        [claims, { ...options, notBefore: 60 }, secret],
        [claims, { ...options, algorithm: 'HS384' }, secret],
        [claims, options, 'another-session-secret-with-at-least-32-characters']
    ]) {
        const token = jwt.sign(payload, signingSecret, signingOptions);
        assert.throws(() => verifySessionToken(token));
    }
});

test('o cookie da sessão protege contra acesso por script e é removido com as mesmas opções', (t) => {
    configureSession(t, 'production');
    let sessionCookie;
    let removedCookie;
    const res = {
        cookie(name, value, options) { sessionCookie = { name, value, options }; },
        clearCookie(name, options) { removedCookie = { name, options }; }
    };
    setSessionCookie(res, user);
    assert.equal(sessionCookie.name, 'authcookie');
    assert.deepEqual(verifySessionToken(sessionCookie.value), user);
    assert.deepEqual(sessionCookie.options, {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 172800000
    });
    clearSessionCookie(res);
    const { maxAge, ...options } = sessionCookie.options;
    assert.deepEqual(removedCookie, { name: 'authcookie', options });
});
