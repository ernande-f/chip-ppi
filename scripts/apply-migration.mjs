import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { getDatabaseConfig } from '../backend/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationPaths = process.argv.slice(2);

if (!migrationPaths.length) {
    throw new Error('Informe o caminho do arquivo SQL da migração.');
}

const { url, options } = getDatabaseConfig();
const sql = postgres(url, { ...options, max: 1, onnotice() {} });

try {
    for (const migrationPath of migrationPaths) {
        const migrationSql = await fs.readFile(path.resolve(__dirname, '..', migrationPath), 'utf8');
        await sql.unsafe(migrationSql);
        console.log(`Migração aplicada com sucesso: ${migrationPath}`);
    }
} catch (error) {
    console.error(`Falha ao aplicar schema/migração (${error.code || error.name}). Confira a conexão, permissões e dados existentes.`);
    process.exitCode = 1;
} finally {
    await sql.end();
}
