import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('HTTPS usa a origem configurada e confia somente no proxy indicado', { timeout: 15_000 }, async (t) => {
    for (const TRUST_PROXY of ['false', 'loopback']) {
        const child = spawn(process.execPath, ['backend/server.js'], {
            env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0', TRUST_PROXY, APP_URL: 'https://chip.escola.test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test', APP_SESSION_SECRET: 'proxy-test-secret-at-least-32-characters', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_ALLOWED_DOMAINS: 'aluno.iffar.edu.br' },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        try {
            const base = await new Promise((resolve, reject) => {
                child.once('error', reject);
                child.once('exit', code => reject(new Error(`Servidor terminou: ${code}`)));
                child.stderr.on('data', data => reject(new Error(String(data))));
                child.stdout.on('data', data => { const match = String(data).match(/http:\/\/localhost:\d+/); if (match) resolve(match[0]); });
            });
            const redirect = await fetch(`${base}/login?x=1`, { redirect: 'manual', headers: { Host: 'forged.test' } });
            assert.equal(redirect.status, 308);
            assert.equal(redirect.headers.get('location'), 'https://chip.escola.test/login?x=1');
            const secure = await fetch(`${base}/login`, { redirect: 'manual', headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '192.0.2.10' } });
            assert.equal(secure.status, TRUST_PROXY === 'loopback' ? 200 : 308);
            assert.ok(secure.headers.get('strict-transport-security'));
        } finally {
            if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
        }
    }
});
