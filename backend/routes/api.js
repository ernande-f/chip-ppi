import express from 'express';
import sql from '../db.js';
import bcrypt from 'bcrypt';
import { encrypt, decrypt } from '../crypto.js';

const router = express.Router();

router.get('/test-db', async (req, res) => {
    try {
        const result = await sql`SELECT NOW()`;
        res.json({ success: true, time: result[0].now, message: 'Conexão deu certo' });
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

    try {
        const result = await sql`SELECT * FROM usuario WHERE email = ${email}`;
        if (result.length === 0) {
            return res.status(401).json({ success: false, message: 'Credenciais inválidas' });
        }

        const user = result[0];

        const senhaCorreta = await bcrypt.compare(password, user.senha);
        if (!senhaCorreta) {
            return res.status(401).json({ success: false, message: 'Credenciais inválidas' });
        }

        const { password: _, cpf: __, ...userSemDadosSensiveis } = user;
        res.json({ success: true, user: userSemDadosSensiveis });
    } catch (error) {
        console.error('Erro ao acessar o banco de dados:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});


router.post('/register', async (req, res) => {
    const { name, email, cpf, password } = req.body;

    try {
        const existingUser = await sql`SELECT * FROM usuario WHERE email = ${email}`;
        if (existingUser.length > 0) {
            return res.status(400).json({ success: false, message: 'Email já registrado' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const encryptedCPF = encrypt(cpf);
        const result = await sql`
            INSERT INTO usuario (nome, email, cpf, senha) 
            VALUES (${name}, ${email}, ${encryptedCPF}, ${hashedPassword}) 
            RETURNING id_usuario, nome, email
        `;
        res.json({ success: true, user: result[0] });
    } catch (error) {
        console.error('Erro ao acessar o banco de dados:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

export default router;
