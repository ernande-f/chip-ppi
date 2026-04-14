import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import apiRoutes from './routes/api.js';
import pageRoutes from './routes/pages.js';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

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

// Serve os arquivos estáticos da pasta "frontend"
app.use(express.static(path.join(__dirname, '../frontend')));

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