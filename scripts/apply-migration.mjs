import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationPath = process.argv[2];

if (!migrationPath) {
    throw new Error('Informe o caminho do arquivo SQL da migração.');
}

const absolutePath = path.resolve(__dirname, '..', migrationPath);
const migrationSql = await fs.readFile(absolutePath, 'utf8');
const sql = postgres(process.env.DATABASE_URL_POOLER, { max: 1 });

try {
    await sql.unsafe(migrationSql);
    console.log(`Migração aplicada com sucesso: ${migrationPath}`);
} finally {
    await sql.end();
}
