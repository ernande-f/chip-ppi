import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import apiRoutes from './routes/api.js';
import { verifySupabaseAuth } from './middleware/authSupabase.js';
import pageRoutes from './routes/pages.js';
import { getProfileByAuthUserId } from './services/userProfile.js';
import cookieParser from 'cookie-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_PAGE_PATHS = new Set([
    '/login',
    '/register',
    '/redefinir-senha',
    '/nova-senha',
    '/pages/login.html',
    '/pages/cadastro.html',
    '/pages/redefinir-senha.html',
    '/pages/nova-senha.html'
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

// --- Auth and Cookies ---
// const cookieParser = require("cookieParser");
// const jwt = require("jsonwebtoken");
// app.use(cookieParser());

// --- Segurança: Helmet (headers HTTP seguros + HSTS) ---
app.use(helmet());

// --- Segurança: Redirecionar HTTP → HTTPS em produção ---
if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
        if (req.headers['x-forwarded-proto'] !== 'https') {
            return res.redirect(301, `https://${req.headers.host}${req.url}`);
        }
        next();
    });
}

// --- Segurança: Proteção CSRF via verificação de Origin ---
const ALLOWED_ORIGINS = [
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    process.env.APP_URL // ex: https://chip-ppi.vercel.app
].filter(Boolean);

app.use((req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        const origin = req.headers['origin'] || req.headers['referer'];
        if (!origin || !ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed))) {
            return res.status(403).json({ error: 'Requisição bloqueada (CSRF)' });
        }
    }
    next();
});

// --- Segurança: Rate Limiting global ---
app.use(rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100,
    message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' }
}));

// --- Segurança: Rate Limiting mais restritivo para autenticação ---
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Muitas tentativas. Aguarde 15 minutos.' }
});
app.use('/api/login', authLimiter);
app.use('/api/register', authLimiter);

// Middleware para processar JSON e Cookies
app.use(express.json());
app.use(cookieParser());

app.use((req, res, next) => {
    const isHtmlRequest =
        req.method === 'GET' &&
        (req.path === '/' || req.path.endsWith('.html') || PUBLIC_PAGE_PATHS.has(req.path));

    if (!isHtmlRequest || PUBLIC_PAGE_PATHS.has(req.path)) {
        return next();
    }

    return verifySupabaseAuth(req, res, async () => {
        if (!TECH_ONLY_PAGE_PATHS.has(req.path)) {
            return next();
        }

        try {
            const profile = await getProfileByAuthUserId(req.user.id);

            if (!hasPrivilegedAccess(profile?.nivel_acesso)) {
                return res.redirect('/');
            }

            return next();
        } catch (error) {
            console.error('Erro ao validar acesso da página:', error);
            return res.status(500).send('Erro ao validar permissões de acesso');
        }
    });
});

// Serve os arquivos estáticos da pasta "frontend"
app.use(express.static(path.join(__dirname, '../frontend'), { index: false }));

// Rotas da Aplicação
app.use('/api', apiRoutes);
app.use('/', pageRoutes);

app.listen(PORT, () => {
    console.log(`Servidor rodando em: http://localhost:${PORT}`);
});

app.get('/logout', (req, res) => {
    res.clearCookie('authcookie', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict'
    });
    res.json({ success: true, message: 'Logout bem-sucedido' });
});
