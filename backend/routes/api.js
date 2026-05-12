import express from 'express';
import { verifySupabaseAuth } from '../middleware/authSupabase.js';
import {
    getProfileSummaryByAuthUserId,
    updateProfileByAuthUserId,
    upsertUserProfile
} from '../services/userProfile.js';
import { supabaseAdmin, supabaseAuth } from '../supabase.js';

const router = express.Router();

function getAppUrl(req) {
    return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

function isEmailConfirmationDisabled() {
    return ['true', '1', 'yes', 'on'].includes(
        (process.env.SUPABASE_DISABLE_EMAIL_CONFIRMATION || '').toLowerCase()
    );
}

router.get('/test-db', async (req, res) => {
    try {
        res.json({ success: true, message: 'Conexão deu certo' });
    } catch (error) {
        console.error('Erro ao acessar o banco de dados:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// ======SUPABASE AUTH=====

router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email e senha são obrigatórios' });
    }

    try {
        const { data, error } = await supabaseAuth.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            console.error('Erro no login:', error);
            return res.status(401).json({ success: false, message: 'Credenciais inválidas' });
        }

        // Armazenar sessão no cookie
        res.cookie('authcookie', data.session.access_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Strict',
            maxAge: data.session.expires_in * 1000
        });

        const profile = await upsertUserProfile({
            authUserId: data.user.id,
            email: data.user.email,
            name: data.user.user_metadata?.name
        });

        res.json({
            success: true,
            user: {
                id: data.user.id,
                email: data.user.email,
                user_metadata: data.user.user_metadata,
                profile
            } 
        });
    } catch (error) {
        console.error('Erro ao fazer login:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

router.post('/register', async (req, res) => {
    const { name, email, cpf, password } = req.body;

    if (!name || !email || !cpf || !password) {
        return res.status(400).json({ success: false, message: 'Todos os campos são obrigatórios' });
    }

    try {
        let data;
        let error;

        if (isEmailConfirmationDisabled()) {
            ({ data, error } = await supabaseAdmin.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: {
                    name,
                    created_without_email_confirmation: true
                }
            }));
        } else {
            ({ data, error } = await supabaseAuth.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        name
                    }
                },
            }));
        }

        if (error) {
            console.error('Erro no registro:', error);
            return res.status(400).json({ success: false, message: error.message });
        }

        const profile = await upsertUserProfile({
            authUserId: data.user.id,
            email,
            name,
            cpf
        });

        res.json({
            success: true,
            user: {
                id: data.user.id,
                email: data.user.email,
                name: data.user.user_metadata?.name,
                profile
            },
            requiresEmailConfirmation: !isEmailConfirmationDisabled() && !data.session
        });
    } catch (error) {
        console.error('Erro ao registrar:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ success: false, message: 'Informe um email válido.' });
    }

    try {
        const { error } = await supabaseAuth.auth.resetPasswordForEmail(email, {
            redirectTo: `${getAppUrl(req)}/nova-senha`
        });

        if (error) {
            console.error('Erro ao enviar email de redefinição:', error);
            return res.status(500).json({ error: 'Erro interno do servidor' });
        }

        res.json({ success: true, message: 'Email de redefinição de senha enviado com sucesso' });
    } catch (error) {
        console.error('Erro ao redefinir senha:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Exemplo de rota da API para o futuro
router.get('/status', (req, res) => {
    res.json({ message: 'API do CHIP-PPI está funcionando!' });
});

router.get('/session', verifySupabaseAuth, async (req, res) => {
    try {
        const profile = await upsertUserProfile({
            authUserId: req.user.id,
            email: req.user.email,
            name: req.user.user_metadata?.name
        });

        res.json({
            success: true,
            user: req.user,
            profile
        });
    } catch (error) {
        console.error('Erro ao consultar sessão:', error);
        res.status(500).json({ success: false, message: 'Erro ao consultar sessão' });
    }
});

router.get('/profile', verifySupabaseAuth, async (req, res) => {
    try {
        const profile = await getProfileSummaryByAuthUserId(req.user.id);

        if (!profile) {
            return res.status(404).json({ success: false, message: 'Perfil não encontrado.' });
        }

        res.json({
            success: true,
            profile
        });
    } catch (error) {
        console.error('Erro ao consultar perfil:', error);
        res.status(500).json({ success: false, message: 'Erro ao consultar perfil.' });
    }
});

router.patch('/profile', verifySupabaseAuth, async (req, res) => {
    const { name } = req.body;

    try {
        const normalizedName = name?.trim();

        if (normalizedName) {
            const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
                user_metadata: {
                    ...(req.user.user_metadata || {}),
                    name: normalizedName
                }
            });

            if (authUpdateError) {
                console.error('Erro ao sincronizar nome no auth:', authUpdateError);
                return res.status(400).json({
                    success: false,
                    message: authUpdateError.message || 'Erro ao sincronizar o nome do perfil.'
                });
            }
        }

        const profile = await updateProfileByAuthUserId(req.user.id, { name });

        if (!profile) {
            return res.status(404).json({ success: false, message: 'Perfil não encontrado.' });
        }

        res.json({
            success: true,
            message: 'Perfil atualizado com sucesso.',
            profile
        });
    } catch (error) {
        console.error('Erro ao atualizar perfil:', error);

        const isValidationError = error.message?.includes('nome válido') || error.message?.includes('obrigatório');
        const status = isValidationError ? 400 : 500;

        res.status(status).json({
            success: false,
            message: isValidationError ? error.message : 'Erro ao atualizar perfil.'
        });
    }
});

router.post('/update-password', verifySupabaseAuth, async (req, res) => {
    const { password } = req.body;

    if (!password || password.length < 8) {
        return res.status(400).json({ success: false, message: 'A senha deve ter pelo menos 8 caracteres.' });
    }

    try {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
            password
        });

        if (error) {
            console.error('Erro ao atualizar senha:', error);
            return res.status(400).json({ success: false, message: error.message });
        }

        res.json({ success: true, message: 'Senha atualizada com sucesso.' });
    } catch (error) {
        console.error('Erro ao atualizar senha:', error);
        res.status(500).json({ success: false, message: 'Erro ao atualizar senha.' });
    }
});

router.post('/logout', async (req, res) => {
    try {
        res.clearCookie('authcookie', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Strict'
        });
        res.json({ success: true, message: 'Desconectado com sucesso' });
    } catch (error) {
        console.error('Erro ao fazer logout:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

export default router;
