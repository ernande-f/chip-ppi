import {
    clearSessionCookie,
    getPasswordUpdateCredential,
    verifySessionToken
} from '../services/sessionAuth.js';
import { supabaseAdmin } from '../supabase.js';
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
    req.profile = await getProfileByAuthUserId(req.user.id);
    assertAccountIsActive(req.profile);
}

export async function verifySessionAuth(req, res, next) {
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

// Links de recuperação de senha do Supabase carregam um access token próprio.
// Esta exceção mantém a recuperação das contas locais durante a transição para
// a sessão do CHIP; as demais rotas aceitam somente a sessão assinada pelo CHIP.
export async function verifySessionOrSupabaseAuth(req, res, next) {
    const credential = getPasswordUpdateCredential(req);

    if (!credential) {
        return handleUnauthorized(req, res, 'Sessão não fornecida.');
    }

    try {
        if (credential.kind === 'supabase-recovery') {
            const { data: { user }, error } = await supabaseAdmin.auth.getUser(credential.token);

            if (error || !user) {
                return handleUnauthorized(req, res, 'Sessão inválida ou expirada.');
            }

            req.user = {
                id: user.id,
                email: user.email,
                user_metadata: user.user_metadata || {},
                auth_provider: 'supabase'
            };
            req.isPasswordRecovery = true;
        } else {
            req.user = verifySessionToken(credential.token);
        }

        await attachActiveProfile(req);
        return next();
    } catch (error) {
        if (error instanceof AccountAccessError) {
            return handleForbidden(req, res, error.message);
        }

        if (error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError') {
            return handleUnauthorized(req, res, 'Sua sessão expirou. Entre novamente.');
        }

        console.error('Erro ao validar token de recuperação:', error);
        return res.status(500).json({ error: 'Erro interno do servidor' });
    }
}
