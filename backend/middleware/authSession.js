import {
    clearSessionCookie,
    verifySessionToken
} from '../services/sessionAuth.js';
import { getProfileByAuthUserId } from '../services/userProfile.js';
import { AccountAccessError, assertAccountIsActive } from '../services/accountValidation.js';

function handleUnauthorized(req, res, message) {
    const acceptsHtml = req.method === 'GET' && !req.originalUrl.startsWith('/api/');

    if (acceptsHtml) {
        return res.redirect('/login');
    }

    return res.status(401).json({ success: false, message });
}

function handleForbidden(req, res, message) {
    clearSessionCookie(res);
    const acceptsHtml = req.method === 'GET' && !req.originalUrl.startsWith('/api/');

    if (acceptsHtml) {
        return res.redirect('/login');
    }

    return res.status(403).json({ success: false, message });
}

async function attachActiveProfile(req) {
    if (req.user.auth_provider !== 'google') throw new AccountAccessError('Entre novamente com Google.');
    req.profile = await getProfileByAuthUserId(req.user.id);
    assertAccountIsActive(req.profile);
}

export async function optionalSessionAuth(req, res, next) {
    const token = req.cookies?.authcookie || req.headers.authorization?.split(' ')[1];
    if (!token) return next();
    try {
        req.user = verifySessionToken(token);
        await attachActiveProfile(req);
        return next();
    } catch (error) {
        if (error instanceof AccountAccessError || ['TokenExpiredError', 'JsonWebTokenError', 'NotBeforeError'].includes(error.name)) {
            clearSessionCookie(res);
            req.user = null;
            req.profile = null;
            return next();
        }
        return next(error);
    }
}

export async function verifySessionAuth(req, res, next) {
    // Se o middleware global (server.js) já verificou a sessão neste request,
    // reaproveita o resultado sem consultar o banco novamente.
    if (req._authVerified && req.profile) {
        return next();
    }

    try {
        const token = req.cookies.authcookie || req.headers.authorization?.split(' ')[1];

        if (!token) {
            return handleUnauthorized(req, res, 'Sessão não fornecida.');
        }

        req.user = verifySessionToken(token);
        await attachActiveProfile(req);
        return next();
    } catch (error) {
        if (error instanceof AccountAccessError) {
            return handleForbidden(req, res, error.message);
        }

        if (error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError') {
            return handleUnauthorized(req, res, 'Sua sessão expirou. Entre novamente.');
        }

        console.error('Erro ao verificar sessão:', error);
        return res.status(500).json({ error: 'Erro interno do servidor' });
    }
}
