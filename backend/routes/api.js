import express from 'express';
import sql from '../db.js';
import bcrypt from 'bcrypt';

const router = express.Router();

router.get('/test-db', async (req, res) => {
    try {
        const result = await sql`SELECT NOW()`;
        res.json({ success: true, time: result[0].now, message: 'Conexão deu certo'});
    } catch (error) {
        console.error('Erro ao acessar o banco de dados:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Exemplo de rota da API para o futuro
router.get('/status', (req, res) => {
    res.json({ message: 'API do CHIP-PPI está funcionando!' });
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    // TODO: Implementar autenticação real (hash de senha, tokens, etc)
    try {
        const result = await sql`SELECT * FROM users WHERE email = ${email} AND password = ${password}`;
        if (result.length > 0) {
            res.json({ success: true, user: result[0] });
        } else {
            res.status(401).json({ success: false, message: 'Credenciais inválidas' });
        }
    } catch (error) {
        console.error('Erro ao acessar o banco de dados:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

router.post('/register', async (req, res) => {
    const { name, email, cpf, password } = req.body;

    try {
        // Verificar se o email já existe
        const existingUser = await sql`SELECT * FROM users WHERE email = ${email}`;
        if (existingUser.length > 0) {
            return res.status(400).json({ success: false, message: 'Email já registrado' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await sql`
            INSERT INTO users (name, email, cpf, password) 
            VALUES (${name}, ${email}, ${cpf}, ${hashedPassword}) 
            RETURNING id, name, email, cpf
        `;
        res.json({ success: true, user: result[0] });
    } catch (error) {
        console.error('Erro ao acessar o banco de dados:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

export default router;
