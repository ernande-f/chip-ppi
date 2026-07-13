import express from 'express';
import { verifySessionAuth, verifySessionOrSupabaseAuth } from '../middleware/authSession.js';
import {
    getProfileSummaryByAuthUserId,
    updateProfileByAuthUserId,
    upsertUserProfile,
    upsertInstitutionalUserProfile,
    getAccessLevelLabel
} from '../services/userProfile.js';
import { createProduct, getAllStatuses } from '../services/productService.js';
import { supabaseAdmin, supabaseAuth } from '../supabase.js';
import { authenticateInstitutional } from '../services/institutionalAuth.js';
import { clearSessionCookie, setSessionCookie } from '../services/sessionAuth.js';

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

        const profile = await upsertUserProfile({
            authUserId: data.user.id,
            email: data.user.email,
            name: data.user.user_metadata?.name
        });

        setSessionCookie(res, {
            id: data.user.id,
            email: data.user.email,
            user_metadata: data.user.user_metadata,
            auth_provider: 'supabase'
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

router.post('/institutional-login', async (req, res) => {
    const { cpf, password, type } = req.body;

    try {
        const institutionalUser = await authenticateInstitutional({ cpf, password, type });

        if (!institutionalUser) {
            return res.status(401).json({
                success: false,
                message: 'CPF, senha ou método institucional inválido.'
            });
        }

        const profile = await upsertInstitutionalUserProfile(institutionalUser);

        if (!profile.status_conta) {
            return res.status(403).json({
                success: false,
                message: 'Esta conta está bloqueada. Procure a administração do laboratório.'
            });
        }

        const authProvider = institutionalUser.type === 'S' ? 'sigaa' : 'ldap';
        setSessionCookie(res, {
            id: profile.auth_user_id,
            email: profile.email,
            user_metadata: { name: profile.nome },
            auth_provider: authProvider
        });

        return res.json({
            success: true,
            user: {
                id: profile.auth_user_id,
                email: profile.email,
                user_metadata: { name: profile.nome },
                auth_provider: authProvider
            },
            profile
        });
    } catch (error) {
        const isValidationError = [
            'Informe um CPF válido.',
            'Informe a senha institucional.',
            'Selecione LDAP ou SIGAA.'
        ].includes(error.message);

        if (!isValidationError) {
            console.error('Erro no login institucional:', error.message);
        }

        return res.status(isValidationError ? 400 : 503).json({
            success: false,
            message: error.message || 'Não foi possível concluir o login institucional.'
        });
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

router.get('/session', verifySessionAuth, async (req, res) => {
    try {
        const profile = await getProfileSummaryByAuthUserId(req.user.id);

        if (!profile) {
            return res.status(404).json({ success: false, message: 'Perfil não encontrado.' });
        }

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

router.get('/profile', verifySessionAuth, async (req, res) => {
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

router.patch('/profile', verifySessionAuth, async (req, res) => {
    const { name } = req.body;

    try {
        const normalizedName = name?.trim();

        if (normalizedName && req.user.auth_provider === 'supabase') {
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

router.post('/update-password', verifySessionOrSupabaseAuth, async (req, res) => {
    const { password } = req.body;

    if (!password || password.length < 8) {
        return res.status(400).json({ success: false, message: 'A senha deve ter pelo menos 8 caracteres.' });
    }

    if (req.user.auth_provider !== 'supabase') {
        return res.status(400).json({
            success: false,
            message: 'A senha da conta institucional deve ser alterada nos sistemas do IFFar.'
        });
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
        clearSessionCookie(res);
        res.json({ success: true, message: 'Desconectado com sucesso' });
    } catch (error) {
        console.error('Erro ao fazer logout:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});


// Rota: GET /api/produtos (requer sessão)
router.get('/produtos', verifySessionAuth, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('produto')
            .select('id_produto, nome, descricao_produto, estoque_total, cor, foto_produto')
            .order('nome', { ascending: true });

        if (error) {
            console.error('Erro ao buscar produtos:', error);
            return res.status(500).json({ success: false, message: error.message || 'Erro ao buscar produtos.' });
        }

        res.json({ success: true, produtos: data || [] });
    } catch (error) {
        console.error('Erro na rota /produtos:', error);
        res.status(500).json({ success: false, message: 'Erro interno ao buscar produtos.' });
    }
});

router.post('/produtos', verifySessionAuth, async (req, res) => {
    const { nome, estoque_total, cor, foto_produto, categorias } = req.body;

    try {
        // Verificar se é técnico ou adm
        const profile = await getProfileSummaryByAuthUserId(req.user.id);

        if (!profile) {
            return res.status(404).json({ success: false, message: 'Perfil não encontrado.' });
        }

        const label = getAccessLevelLabel(profile.nivel_acesso);

        if (label === 'Estudante') {
            return res.status(403).json({ success: false, message: 'Acesso negado. Apenas técnicos podem cadastrar itens.' });
        }

        if (!nome || !estoque_total) {
            return res.status(400).json({ success: false, message: 'Nome e quantidade em estoque são obrigatórios.' });
        }

        // Buscar o primeiro status_produto disponível (ex: "Disponível")
        // Como o sistema está começando, vamos assumir que id_statusproduto = 1 existe ou buscar
        const statuses = await getAllStatuses();
        const defaultStatus = statuses[0]?.id_statusproduto || 1;

        const produto = await createProduct({
            nome,
            estoque_total: parseInt(estoque_total),
            cor,
            foto_produto,
            id_statusproduto: defaultStatus,
            categorias: categorias || []
        });

        res.json({ success: true, message: 'Produto cadastrado com sucesso!', produto });
    } catch (error) {
        console.error('Erro ao cadastrar produto:', error);
        res.status(500).json({ success: false, message: 'Erro ao cadastrar produto.' });
    }
});


// ÚLTIMA LINHA ABAIXO!!!
export default router;
