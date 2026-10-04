import sql from '../db.js';

export async function checkDatabase() {
    const [status] = await sql`
        WITH required(table_name, column_name) AS (VALUES
            ('usuario', 'google_sub'), ('usuario', 'auth_provider'), ('usuario', 'auth_user_id'),
            ('pedido', 'retirada_prevista'), ('pedido', 'devolucao_prevista'), ('pedido', 'justificativa'),
            ('produto', 'foto_produto'), ('lista_de_desejos', 'quantidade')
        )
        SELECT current_setting('TimeZone') AS timezone,
            NOT EXISTS (
                SELECT 1 FROM required LEFT JOIN information_schema.columns actual
                ON actual.table_schema = 'public' AND actual.table_name = required.table_name AND actual.column_name = required.column_name
                WHERE actual.column_name IS NULL
            ) AS schema_ready
    `;
    if (!status.schema_ready) throw new Error('Schema incompleto. Execute npm run db:setup antes de iniciar o CHIP.');
    return status;
}
