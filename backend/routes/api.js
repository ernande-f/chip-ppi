import express from 'express';
import sql from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { createClient } from '@supabase/supabase-js';
import { verifySupabaseAuth } from '../middleware/authSupabase.js';

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

router.get('/test-db', async (req, res) => {
    try {
        const result = await sql`SELECT NOW()`;
        res.json({ success: true, time: result[0].now, message: 'Conexão deu certo' });
    } catch (error) {
        console.error('Erro ao acessar o banco de dados:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// ======SUPABASE AUTH=====

router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
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

        res.json({ 
            success: true, 
            user: { 
                id: data.user.id, 
                email: data.user.email,
                user_metadata: data.user.user_metadata 
            } 
        });
    } catch (error) {
        console.error('Erro ao fazer login:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

router.post('/register', async (req, res) => {
    const { name, email, cpf, password } = req.body;

    try {
        const { data, error } = await supabase.auth.admin.createUser({
            email,
            password,
            user_metadata: { 
                name,
                cpf: encrypt(cpf)
            },
            email_confirm: true
        });

        if (error) {
            console.error('Erro no registro:', error);
            return res.status(400).json({ success: false, message: error.message });
        }

        res.json({ 
            success: true, 
            user: { 
                id: data.user.id, 
                email: data.user.email,
                name: data.user.user_metadata.name
            } 
        });
    } catch (error) {
        console.error('Erro ao registrar:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;

    try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: process.env.APP_URL + '/redefinir-senha'
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

router.post('/logout', verifySupabaseAuth, async (req, res) => {
    try {
        res.clearCookie('authcookie');
        res.json({ success: true, message: 'Desconectado com sucesso' });
    } catch (error) {
        console.error('Erro ao fazer logout:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

export default router;
