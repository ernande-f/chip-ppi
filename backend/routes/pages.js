import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { verifySupabaseAuth } from '../middleware/authSupabase.js';
import { getProfileByAuthUserId } from '../services/userProfile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Rota principal (Cai no login / index.html)
router.get('/', verifySupabaseAuth, async (req, res) => {

    try {
        const user = await getProfileByAuthUserId(req.user.id);

        if (user?.nivel_acesso === 1 || user?.nivel_acesso === 'tecnico' || user?.nivel_acesso === 'adm') {
            return res.sendFile(path.join(__dirname, '../../frontend/pages/index-tec.html'));
        }

        return res.redirect('/pages/pagina-inicial.html');
    }
    catch (error) {
        console.error('Erro ao carregar página inicial:', error);
        return res.status(500).send('Erro ao carregar a página inicial');
    }
});

router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/pages/login.html'));
});

router.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/pages/cadastro.html'));
});

router.get('/redefinir-senha', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/pages/redefinir-senha.html'));
});

router.get('/nova-senha', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/pages/nova-senha.html'));
});

router.get('/perfil', verifySupabaseAuth, async (req, res) => {
    try {
        return res.sendFile(path.join(__dirname, '../../frontend/pages/perfil.html'));
    } catch (error) {
        console.error('Erro ao carregar perfil:', error);
        return res.status(500).send('Erro ao carregar a página de perfil');
    }
});

router.get('/editar-perfil', verifySupabaseAuth, async (req, res) => {
    try {
        return res.sendFile(path.join(__dirname, '../../frontend/pages/editar-perfil.html'));
    } catch (error) {
        console.error('Erro ao carregar edição de perfil:', error);
        return res.status(500).send('Erro ao carregar a página de edição de perfil');
    }
});

router.get('/pedidos', verifySupabaseAuth, async (req, res) => {
    try {
        return res.redirect('/pages/seus-pedidos.html');
    } catch (error) {
        console.error('Erro ao carregar pedidos:', error);
        return res.status(500).send('Erro ao carregar a página de pedidos');
    }
});

router.get('/pesquisa', verifySupabaseAuth, async (req, res) => {
    try {
        return res.redirect('/pages/pesquisa.html');
    } catch (error) {
        console.error('Erro ao carregar pesquisa:', error);
        return res.status(500).send('Erro ao carregar a página de pesquisa');
    }
});

export default router;
