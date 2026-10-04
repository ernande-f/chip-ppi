import postgres from 'postgres';
import { getDatabaseConfig } from '../backend/config.js';

// Copia somente tabelas da aplicação para um destino vazio já inicializado.
const sourceUrl = process.env.SOURCE_DATABASE_URL;
const targetUrl = process.env.DATABASE_URL;
if (!sourceUrl || !targetUrl || sourceUrl === targetUrl) throw new Error('Defina SOURCE_DATABASE_URL e DATABASE_URL distintos.');
const sourceConfig = getDatabaseConfig({ ...process.env, DATABASE_URL: sourceUrl });
const targetConfig = getDatabaseConfig();
const source = postgres(sourceConfig.url, { ...sourceConfig.options, max: 1 });
const target = postgres(targetConfig.url, { ...targetConfig.options, max: 1 });
const tables = ['categoria', 'status_produto', 'status_pedido', 'notificacao', 'usuario', 'produto', 'pedido', 'renovacao', 'log_auditoria', 'notificar', 'lista_de_desejos', 'contem_lista', 'categorizar', 'renovacao_pedido'];

try {
    await source.begin('isolation level repeatable read read only', async (read) => {
        await target.begin(async (write) => {
            // Os únicos registros permitidos no destino são os status semeados pelo schema.
            for (const table of tables.filter(table => !table.startsWith('status_'))) {
                const [row] = await write`SELECT count(*)::int AS total FROM ${write(table)}`;
                if (row.total) throw new Error(`Destino não está vazio: ${table}. Cópia cancelada.`);
            }
            await write`DELETE FROM status_produto`;
            await write`DELETE FROM status_pedido`;
            for (const table of tables) {
                const rows = await read`SELECT * FROM ${read(table)}`;
                // ponytail: cópia em memória por tabela; usar pg_dump/COPY quando o acervo crescer.
                for (const row of rows) {
                    const columns = Object.keys(row);
                    const names = columns.map(column => `"${column.replaceAll('"', '""')}"`).join(', ');
                    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
                    await write.unsafe(`INSERT INTO "${table}" (${names}) OVERRIDING SYSTEM VALUE VALUES (${placeholders})`, columns.map(column => row[column]));
                }
                const identityColumns = await write`
                    SELECT column_name FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = ${table} AND is_identity = 'YES'
                `;
                for (const { column_name: column } of identityColumns) {
                    await write`SELECT setval(pg_get_serial_sequence(${table}, ${column}), COALESCE(max(${write(column)}), 1), max(${write(column)}) IS NOT NULL) FROM ${write(table)}`;
                }
                console.log(`${table}: ${rows.length} registros copiados`);
            }
        });
    });
    console.log('Cópia concluída. A origem não foi alterada.');
} finally {
    await Promise.all([source.end(), target.end()]);
}
