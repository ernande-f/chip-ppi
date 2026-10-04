import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getServerConfig, getGoogleConfig } from './config.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import apiRoutes from './routes/api.js';
import { verifySessionAuth } from './middleware/authSession.js';
import pageRoutes from './routes/pages.js';
import cookieParser from 'cookie-parser';
import sql from './db.js';
import { getSessionSecret } from './services/sessionAuth.js';
import { checkDatabase } from './services/databaseStatus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const config = getServerConfig();
getGoogleConfig();
getSessionSecret();
app.set('trust proxy', config.trustProxy);
const PUBLIC_PAGE_PATHS = new Set([
    '/',
    '/index.html',
    '/pages/pagina-inicial.html',
    '/login',
    '/register',
    '/redefinir-senha',
    '/nova-senha',
    '/termo',
    '/termo-de-responsabilidade',
    '/termo_responsabilidade.html',
    '/pages/login.html',
    '/pages/cadastro.html',
    '/pages/redefinir-senha.html',
    '/pages/nova-senha.html',
    '/pages/termo_responsabilidade.html'
]);
const TECH_ONLY_PAGE_PATHS = new Set([
    '/pages/index-tec.html',
    '/pages/inicio-tec.html',
    '/pages/pedidos.html',
    '/pages/perfil-tec.html',
    '/pages/editar-perfil-tec.html',
    '/pages/cadastro-item.html'
]);

function hasPrivilegedAccess(level) {
    return level === 1 || level === 2 || level === 'tecnico' || level === 'adm' || level === 'administrador';
}

// --- Segurança: Helmet (headers HTTP seguros + HSTS) ---
// Fontes e ícones são servidos por esta instalação.
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                fontSrc: ["'self'"],
                imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
                connectSrc: ["'self'"],
                upgradeInsecureRequests: config.production ? [] : null
            }
        },
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        strictTransportSecurity: config.production ? undefined : false
    })
);

// --- Segurança: Redirecionar HTTP → HTTPS em produção ---
if (config.production) {
    app.use((req, res, next) => {
        if (!req.secure && req.path !== '/api/health') {
            return res.redirect(308, `${config.appUrl}${req.originalUrl}`);
        }
        next();
    });
}

// --- Segurança: Proteção CSRF via verificação de Origin ---
const ALLOWED_ORIGINS = new Set([
    ...(!config.production ? [`http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`] : []),
    config.appUrl
]
    .filter(Boolean)
    .map((value) => new URL(value).origin));

function isAllowedRequestSource(source) {
    try {
        return ALLOWED_ORIGINS.has(new URL(source).origin);
    } catch {
        return false;
    }
}

app.use((req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        const origin = req.headers['origin'] || req.headers['referer'];
        if (!origin || !isAllowedRequestSource(origin)) {
            return res.status(403).json({ error: 'Requisição bloqueada (CSRF)' });
        }
    }
    next();
});

// --- Segurança: Rate Limiting global ---
app.use(rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: config.globalRateLimit,
    message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' }
}));

// --- Segurança: Rate Limiting mais restritivo para autenticação ---
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.authRateLimit,
    message: { error: 'Muitas tentativas. Aguarde 15 minutos.' }
});
app.use('/api/auth/google', authLimiter);
app.use('/api/login', authLimiter);
app.use('/api/institutional-login', authLimiter);
app.use('/api/register', authLimiter);

app.get('/api/health', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
        await checkDatabase();
        return res.json({ status: 'ready' });
    } catch {
        return res.status(503).json({ status: 'unavailable' });
    }
});

// URLs antigas de cadastro e senha deixam de oferecer autenticação paralela.
app.get(['/register', '/redefinir-senha', '/nova-senha', '/pages/cadastro.html', '/pages/redefinir-senha.html', '/pages/nova-senha.html'], (req, res) => res.redirect('/login'));

// Middleware para processar JSON e Cookies. Fotos do catálogo são aceitas até 2 MB
// no navegador; o limite considera a expansão do Base64.
app.use(express.json({ limit: '3mb' }));
app.use(cookieParser());

app.use((req, res, next) => {
    const isHtmlRequest =
        req.method === 'GET' &&
        (req.path === '/' || req.path.endsWith('.html') || PUBLIC_PAGE_PATHS.has(req.path));

    if (!isHtmlRequest || PUBLIC_PAGE_PATHS.has(req.path)) {
        return next();
    }

    return verifySessionAuth(req, res, async () => {
        // Sinaliza que a autenticação já foi verificada neste request,
        // evitando que o router de páginas execute verifySessionAuth novamente.
        req._authVerified = true;

        if (req.path === '/pages/seus-pedidos.html' && hasPrivilegedAccess(req.profile?.nivel_acesso)) {
            return res.redirect('/pedidos.html');
        }

        if (!TECH_ONLY_PAGE_PATHS.has(req.path)) {
            return next();
        }

        if (!hasPrivilegedAccess(req.profile?.nivel_acesso)) {
            return res.redirect('/');
        }

        return next();
    });
});

// Redireciona protótipos antigos antes que o middleware estático os sirva.
app.get('/index.html', (req, res) => res.redirect('/'));
app.get('/pages/perfil-tec.html', (req, res) => res.redirect('/perfil-tec.html'));
app.get('/pages/editar-perfil-tec.html', (req, res) => res.redirect('/editar-perfil-tec.html'));

// Serve os arquivos estáticos da pasta "frontend".
// Imagens e fontes ficam em cache no browser por 30 dias.
app.use(express.static(path.join(__dirname, '../frontend'), {
    index: false,
    setHeaders(res, filePath) {
        if (/\.(png|jpg|jpeg|webp|avif|svg|woff2?|ico)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
        }
    }
}));

// Rotas da Aplicação
app.use('/api', apiRoutes);
app.use('/', pageRoutes);

app.use((error, req, res, next) => {
    if (error?.type === 'entity.too.large') {
        return res.status(413).json({
            success: false,
            message: 'A foto é muito grande. Envie uma imagem de até 2 MB.'
        });
    }

    console.error('Erro na requisição:', error.code || error.name);
    return res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
});

const server = app.listen(config.port, config.host, () => {
    console.log(`Servidor rodando em: http://localhost:${server.address().port}`);
});
server.on('error', (error) => {
    console.error(`Não foi possível iniciar o servidor (${error.code}). Confira HOST e PORT.`);
    process.exitCode = 1;
});

let stopping = false;
async function shutdown() {
    if (stopping) return;
    stopping = true;
    server.close();
    await sql.end({ timeout: 5 });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
