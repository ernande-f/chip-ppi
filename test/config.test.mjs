import assert from 'node:assert/strict';
import test from 'node:test';
import { getDatabaseConfig, getGoogleConfig, getServerConfig } from '../backend/config.js';

test('a configuração usa a URL da instalação e exige HTTPS em produção', () => {
    const local = { APP_URL: 'http://localhost:3100', PORT: '3100' };
    assert.equal(getServerConfig(local).port, 3100);
    assert.equal(getServerConfig(local).host, '127.0.0.1');
    assert.equal(getServerConfig({ APP_URL: 'https://chip.escola.edu.br/', NODE_ENV: 'production' }).appUrl, 'https://chip.escola.edu.br');
    for (const APP_URL of [undefined, 'not-a-url', 'https://chip.test/path', 'https://user:pass@chip.test', 'https://chip.test/?x=1']) {
        assert.throws(() => getServerConfig({ APP_URL }));
    }
    assert.throws(() => getServerConfig({ ...local, NODE_ENV: 'production' }));
    for (const PORT of ['3000abc', '-1', '65536']) assert.throws(() => getServerConfig({ ...local, PORT }));
});

test('apenas os proxies explicitamente configurados são confiáveis', () => {
    const env = { APP_URL: 'https://chip.test' };
    assert.equal(getServerConfig(env).trustProxy, false);
    assert.deepEqual(getServerConfig({ ...env, TRUST_PROXY: 'loopback, 192.0.2.5, 10.1.1.0/24' }).trustProxy, ['loopback', '192.0.2.5', '10.1.1.0/24']);
    for (const TRUST_PROXY of ['true', '1', '0.0.0.0/0', '192.0.2.5/99', 'proxy.example']) {
        assert.throws(() => getServerConfig({ ...env, TRUST_PROXY }));
    }
});

test('a conexão PostgreSQL exige DATABASE_URL e fixa o fuso da aplicação', () => {
    const env = { DATABASE_URL: 'postgresql://chip:password@127.0.0.1:5432/chip' };
    assert.equal(getDatabaseConfig(env).options.connection.TimeZone, 'America/Sao_Paulo');
    assert.equal(getDatabaseConfig({ ...env, DATABASE_TIMEZONE: 'UTC' }).options.connection.TimeZone, 'UTC');
    assert.throws(() => getDatabaseConfig({ DATABASE_URL_POOLER: env.DATABASE_URL }));
    assert.throws(() => getDatabaseConfig({ DATABASE_URL: 'https://db.test' }));
    assert.throws(() => getDatabaseConfig({ ...env, DATABASE_TIMEZONE: 'invalid' }));
});

test('OAuth usa a URL de cada instalação e recusa credenciais de exemplo', () => {
    const env = { APP_URL: 'https://chip.escola.edu.br', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_ALLOWED_DOMAINS: ' ALUNO.IFFAR.EDU.BR,iffarroupilha.edu.br ' };
    const config = getGoogleConfig(env);
    assert.equal(config.redirectUri, 'https://chip.escola.edu.br/api/auth/google/callback');
    assert.deepEqual(config.domains, ['aluno.iffar.edu.br', 'iffarroupilha.edu.br']);
    assert.throws(() => getGoogleConfig({ ...env, GOOGLE_CLIENT_SECRET: 'YOUR_GOOGLE_CLIENT_SECRET' }));
    assert.throws(() => getGoogleConfig({ ...env, GOOGLE_ALLOWED_DOMAINS: '' }));
});
