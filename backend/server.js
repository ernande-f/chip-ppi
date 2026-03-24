import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from './db.js';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/test-db', async (req, res) => {
    try {
        const result = await sql`SELECT NOW()`;
        res.json({ success: true, time: result[0].now, message: 'Conexão deu certo'});
    } catch (error) {
        console.error('Erro ao acessar o banco de dados:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Middleware para processar JSON (útil para APIs)
app.use(express.json());

// Serve os arquivos estáticos da pasta "frontend"
app.use(express.static(path.join(__dirname, '../frontend')));

// Rota principal (Cai no login / index.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/pages/login.html'));
});

// Exemplo de rota da API para o futuro
app.get('/api/status', (req, res) => {
    res.json({ message: 'API do CHIP-PPI está funcionando!' });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em: http://localhost:${PORT}`);
});