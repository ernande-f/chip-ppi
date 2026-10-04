import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationPaths = process.argv.slice(2);

if (!migrationPaths.length) {
    throw new Error('Informe o caminho do arquivo SQL da migração.');
}

const sql = postgres(process.env.DATABASE_URL || process.env.DATABASE_URL_POOLER, { max: 1, prepare: false });

try {
    for (const migrationPath of migrationPaths) {
        const migrationSql = await fs.readFile(path.resolve(__dirname, '..', migrationPath), 'utf8');
        await sql.unsafe(migrationSql);
        console.log(`Migração aplicada com sucesso: ${migrationPath}`);
    }
} finally {
    await sql.end();
}
