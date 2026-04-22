import 'dotenv/config';
import { supabaseAdmin } from '../supabase.js';

function handleUnauthorized(req, res, message) {
    const acceptsHtml = req.method === 'GET' && !req.originalUrl.startsWith('/api/');

    if (acceptsHtml) {
        return res.redirect('/login');
    }

    return res.status(401).json({ success: false, message });
}

export async function verifySupabaseAuth(req, res, next) {
    try {
        const token = req.cookies.authcookie || req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return handleUnauthorized(req, res, 'Token não fornecido');
        }

        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

        if (error || !user) {
            return handleUnauthorized(req, res, 'Token inválido ou expirado');
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Erro ao verificar autenticação:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
}
