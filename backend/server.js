import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import apiRoutes from './routes/api.js';
import pageRoutes from './routes/pages.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para processar JSON (útil para APIs)
app.use(express.json());

// Serve os arquivos estáticos da pasta "frontend"
app.use(express.static(path.join(__dirname, '../frontend')));

// Rotas da Aplicação
app.use('/api', apiRoutes);
app.use('/', pageRoutes);

app.listen(PORT, () => {
    console.log(`Servidor rodando em: http://localhost:${PORT}`);
});