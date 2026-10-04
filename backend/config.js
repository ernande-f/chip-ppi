import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// O serviço pode ser iniciado fora da pasta do projeto; o ambiente do processo prevalece.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

function integer(value, name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
    if (value === undefined || value === '') return fallback;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
        throw new Error(`${name} deve ser um número inteiro entre ${min} e ${max}.`);
    }
    return Number(value);
}

function appUrl(env) {
    let url;
    try { url = new URL(env.APP_URL); } catch { throw new Error('Defina APP_URL com a URL pública desta instalação.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw new Error('APP_URL deve conter somente a origem HTTP/HTTPS, sem caminho ou credenciais.');
    }
    if (env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('APP_URL deve usar HTTPS em produção.');
    return url.origin;
}

function trustProxy(value) {
    if (!value || value === 'false') return false;
    const entries = value.split(',').map(entry => entry.trim());
    for (const entry of entries) {
        if (entry === 'loopback') continue;
        const [address, mask, extra] = entry.split('/');
        const version = isIP(address);
        if (!version || extra !== undefined || (mask !== undefined && (!/^\d+$/.test(mask) || Number(mask) < 1 || Number(mask) > (version === 4 ? 32 : 128)))) {
            throw new Error('TRUST_PROXY deve ser false, loopback ou IPs/sub-redes dos proxies conhecidos.');
        }
    }
    return entries;
}

export function getServerConfig(env = process.env) {
    return {
        appUrl: appUrl(env),
        production: env.NODE_ENV === 'production',
        host: env.HOST || '127.0.0.1',
        port: integer(env.PORT, 'PORT', 3000, 0, 65535),
        trustProxy: trustProxy(env.TRUST_PROXY),
        globalRateLimit: integer(env.GLOBAL_RATE_LIMIT_MAX, 'GLOBAL_RATE_LIMIT_MAX', 500),
        authRateLimit: integer(env.AUTH_RATE_LIMIT_MAX, 'AUTH_RATE_LIMIT_MAX', 20)
    };
}

export function getDatabaseConfig(env = process.env) {
    let url;
    try { url = new URL(env.DATABASE_URL); } catch { throw new Error('Defina DATABASE_URL com a conexão PostgreSQL desta instalação.'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
        throw new Error('DATABASE_URL deve identificar um servidor e um banco PostgreSQL.');
    }
    const timezone = env.DATABASE_TIMEZONE || 'America/Sao_Paulo';
    try { new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }); } catch { throw new Error('DATABASE_TIMEZONE deve ser um fuso horário válido.'); }
    return {
        url: env.DATABASE_URL,
        options: { prepare: false, connect_timeout: 5, connection: { TimeZone: timezone, application_name: 'chip-ppi' } }
    };
}

export function getGoogleConfig(env = process.env) {
    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    const domains = (env.GOOGLE_ALLOWED_DOMAINS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    if (!clientId || !clientSecret || /YOUR_|CHANGE_ME/.test(clientId + clientSecret)) throw new Error('Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET do cliente OAuth desta instalação.');
    if (!domains.length || domains.some(domain => !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(domain))) throw new Error('Defina GOOGLE_ALLOWED_DOMAINS com os domínios institucionais autorizados.');
    return { clientId, clientSecret, domains, redirectUri: `${appUrl(env)}/api/auth/google/callback` };
}
