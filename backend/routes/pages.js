import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Rota principal (Cai no login / index.html)
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/index.html'));
});

router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/pages/login.html'));
});

router.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/pages/cadastro.html'));
});

/* router.get('/perfil', async (req, res) => {
    
    try {
        const result = await sql`SELECT role FROM users where id = user.id`;
        if (result[0].role === 'tecnico') {
            res.sendFile(path.join(__dirname, '../../frontend/pages/perfil-tec.html'));
        } else {
            res.sendFile(path.join(__dirname, '../../frontend/pages/perfil.html'));
        }
    } catch (error) {
        console.error('Erro ao acessar o banco de dados:', error);
        res.status(500).sendFile(path.join(__dirname, '../../frontend/pages/error.html'));
    }
}); */

export default router;
