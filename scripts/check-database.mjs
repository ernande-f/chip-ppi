import sql from '../backend/db.js';
import { checkDatabase } from '../backend/services/databaseStatus.js';

try {
    const { timezone } = await checkDatabase();
    const [counts] = await sql`
        SELECT (SELECT count(*)::int FROM usuario) AS usuarios,
            (SELECT count(*)::int FROM produto) AS produtos,
            (SELECT count(*)::int FROM pedido) AS pedidos,
            (SELECT count(*)::int FROM produto WHERE foto_produto ~ '^https?://') AS fotos_externas
    `;
    console.log(`PostgreSQL acessível; schema Google/reservas pronto; fuso ${timezone}.`);
    console.log(counts);
} catch (error) {
    console.error(`Banco indisponível ou schema incompleto (${error.code || error.name}). Confira DATABASE_URL, serviço PostgreSQL e npm run db:setup.`);
    process.exitCode = 1;
} finally {
    await sql.end({ timeout: 5 });
}
