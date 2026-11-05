import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sql from '../backend/db.js';
import { CURRENT_TERMS_VERSION } from '../backend/services/orderRules.js';

// Destrutivo: somente execução explícita em PostgreSQL local de desenvolvimento.
const products = 10_000;
const users = 3_000;
const orders = 30_000;
const notifications = 60_000;
const audits = 100_000;
const tables = ['notificacao_email', 'notificar', 'notificacao', 'penalidade_atraso', 'renovacao_pedido',
    'renovacao', 'historico_uso_estoque', 'log_auditoria', 'lista_de_desejos', 'contem_lista',
    'pedido', 'categorizar', 'produto', 'categoria', 'usuario', 'status_pedido', 'status_produto'];

try {
    assert.deepEqual(process.argv.slice(2), ['--reset'], 'Use node scripts/seed-stress.mjs --reset para APAGAR e repopular a base local, sem backup.');
    const url = new URL(process.env.DATABASE_URL);
    assert.ok(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'A carga destrutiva exige banco local fora de produção.');
    console.log(`Limpando ${url.hostname}${url.pathname}, sem backup, e gerando dados fictícios…`);
    const counts = await sql.begin(async db => {
        await db`SET LOCAL lock_timeout = '10s'`;
        await db`SET LOCAL statement_timeout = '120s'`;
        const installed = (await db`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`).map(row => row.tablename);
        assert.deepEqual(installed, [...tables].sort(), 'Estrutura inesperada: confira as tabelas antes de limpar.');
        // Recria só o acesso administrativo institucional; sessões anteriores deixam de valer.
        const operators = await db`SELECT nome, email, google_sub FROM usuario WHERE nivel_acesso = 2 AND auth_provider = 'google' AND google_sub IS NOT NULL AND status_conta`;
        assert.ok(operators.length, 'É necessário um administrador Google ativo para continuar acessando a instalação.');
        await db`TRUNCATE ${db(tables)} RESTART IDENTITY`;
        await db`INSERT INTO status_produto (status_produto) VALUES ('Disponível'), ('Indisponível'), ('Arquivado')`;
        await db`INSERT INTO status_pedido (descricao_status) VALUES ('Pendente'), ('Aprovado'), ('Em separação'), ('Pronto para retirada'), ('Retirado'), ('Devolvido'), ('Negado'), ('Cancelado'), ('Expirado')`;
        await db`INSERT INTO usuario (auth_user_id, nome, email, auth_provider, nivel_acesso)
            SELECT gen_random_uuid(), 'Pessoa TESTE ' || lpad(n::text, 4, '0'), 'chip.teste.' || n || '@example.invalid', 'demo',
                CASE WHEN n = 1 THEN 1 ELSE 0 END FROM generate_series(1, ${users}) n`;
        for (const operator of operators) await db`INSERT INTO usuario (auth_user_id, nome, email, google_sub, auth_provider, nivel_acesso)
            VALUES (${randomUUID()}, ${operator.nome}, ${operator.email}, ${operator.google_sub}, 'google', 2)`;
        await db`INSERT INTO categoria (nome_categoria) SELECT 'Categoria TESTE ' || lpad(n::text, 2, '0') FROM generate_series(1, 40) n`;
        await db`INSERT INTO produto (nome, descricao_produto, estoque_total, cor, foto_produto, id_statusproduto)
            SELECT (ARRAY['Arduino', 'Resistor', 'Capacitor', 'Multímetro', 'Sensor', 'Cabo', 'Conector', 'Protoboard'])[1 + n % 8]
                || ' TESTE ' || lpad(n::text, 5, '0'),
                'Material fictício para teste de volume. ' || repeat('Características técnicas para conferir detalhes, pesquisa e leitura no celular. ', 1 + n % 5),
                CASE WHEN n % 13 = 0 THEN 0 ELSE 40 + n % 160 END,
                (ARRAY['Azul', 'Verde', 'Preto', 'Branco'])[1 + n % 4],
                '/assets/electronic_components_1_1774913851066.png',
                CASE WHEN n % 17 = 0 THEN 3 WHEN n % 13 = 0 THEN 2 ELSE 1 END
            FROM generate_series(1, ${products}) n`;
        await db`INSERT INTO categorizar SELECT 1 + (id_produto % 40), id_produto FROM produto`;
        await db`INSERT INTO categorizar SELECT 1 + ((id_produto + 13) % 40), id_produto FROM produto WHERE id_produto % 3 = 0`;
        await db`INSERT INTO pedido (id_usuario, id_status, data_pedido, data_aprovacao, data_retirada, data_devolucao,
                duracao_dias, estado_termo, timestamp_termo, versao_termo, justificativa, motivo_recusa)
            SELECT 1 + (n - 1) % ${users}, s,
                CASE WHEN n <= ${users} THEN current_date - 3 ELSE current_date - 20 - n % 340 END,
                CASE WHEN s BETWEEN 2 AND 6 OR s = 9 THEN CASE WHEN n <= ${users} THEN current_date - 2 ELSE current_date - 18 - n % 340 END END,
                CASE WHEN s IN (5, 6) THEN CASE WHEN s = 5 THEN current_date - n % 12 ELSE current_date - 17 - n % 340 END END,
                CASE WHEN s = 6 THEN current_date - 10 - n % 340 END,
                7 + n % 9, true, now() - (n % 360) * interval '1 day', ${CURRENT_TERMS_VERSION},
                'TESTE DE FOGO — pedido fictício ' || n,
                CASE WHEN s = 7 THEN 'Solicitação fictícia recusada para teste do histórico.' END
            FROM generate_series(1, ${orders}) n
            CROSS JOIN LATERAL (SELECT CASE WHEN n <= ${users} THEN 1 + (n - 1) % 5 ELSE 6 + (n - 1) % 4 END s) status`;
        await db`INSERT INTO contem_lista (id_pedido, id_produto, qnt_solicitada, qnt_devolvida, qnt_danificada)
            SELECT p.id_pedido, 1 + ((p.id_pedido * 3 + part) % ${products}), 1 + part % 3,
                CASE WHEN p.id_status = 6 THEN 1 + part % 3 WHEN p.id_status = 5 AND p.id_pedido % 4 = 0 THEN 1 ELSE 0 END,
                CASE WHEN p.id_status = 6 AND p.id_pedido % 11 = 0 THEN 1 ELSE 0 END
            FROM pedido p CROSS JOIN generate_series(0, 2) part`;
        await db`INSERT INTO lista_de_desejos (id_usuario, id_produto, quantidade)
            SELECT u.id_usuario, p.id_produto, 1 + u.id_usuario % 3 FROM usuario u
            JOIN produto p ON p.id_produto = 1 + (u.id_usuario * 7) % ${products} WHERE u.auth_provider = 'demo'`;
        await db`INSERT INTO renovacao (data_estendida, justificativa_estendimento, data_solicitacao, status)
            SELECT data_retirada + duracao_dias + 7, 'Renovação fictícia para testar análise.', current_date, 'Pendente'
            FROM pedido WHERE id_status = 5 ORDER BY id_pedido`;
        await db`INSERT INTO renovacao_pedido (id_renovacao, id_pedido)
            SELECT r.id_renovacao, p.id_pedido FROM renovacao r
            JOIN (SELECT id_pedido, row_number() OVER (ORDER BY id_pedido) position FROM pedido WHERE id_status = 5) p ON p.position = r.id_renovacao`;
        await db`INSERT INTO notificacao (mensagem, href, chave_evento, criada_em)
            SELECT 'TESTE DE FOGO — atualização do pedido #' || (1 + (n - 1) % ${orders}), '/pedidos?id_pedido=' || (1 + (n - 1) % ${orders}),
                'teste-fogo:' || n, now() - (n % 720) * interval '1 hour' FROM generate_series(1, ${notifications}) n`;
        await db`INSERT INTO notificar (id_usuario, id_notificacao, lida_em)
            SELECT 1 + (id_notificacao - 1) % ${users}, id_notificacao,
                CASE WHEN id_notificacao % 3 = 0 THEN now() END FROM notificacao`;
        await db`INSERT INTO notificar (id_usuario, id_notificacao)
            SELECT u.id_usuario, n.id_notificacao FROM usuario u CROSS JOIN notificacao n WHERE u.nivel_acesso = 2 AND n.id_notificacao <= 300`;
        await db`INSERT INTO notificacao_email (id_usuario, id_notificacao, estado) SELECT id_usuario, id_notificacao, 'desativado' FROM notificar`;
        await db`INSERT INTO log_auditoria (acao, tabela_afetada, dados_posteriores, "timestamp")
            SELECT 'teste:fogo', 'pedido', jsonb_build_object('id_pedido', 1 + (n - 1) % ${orders}, 'ficticio', true)::text,
                now() - (n % 86400) * interval '1 second' FROM generate_series(1, ${audits}) n`;
        await db`INSERT INTO log_auditoria (acao, tabela_afetada, dados_posteriores, "timestamp")
            SELECT 'pedido:register_return', 'pedido', jsonb_build_object('id_pedido', p.id_pedido, 'observacao', 'Devolução fictícia.',
                'devolucao', (SELECT jsonb_agg(jsonb_build_object('id_produto', i.id_produto::text, 'quantidade', i.qnt_devolvida, 'danificada', i.qnt_danificada))
                    FROM contem_lista i WHERE i.id_pedido = p.id_pedido))::text,
                COALESCE(p.data_devolucao, current_date)::timestamptz
            FROM pedido p WHERE p.id_status = 6 OR (p.id_status = 5 AND p.id_pedido % 4 = 0)`;
        await db`INSERT INTO historico_uso_estoque (id_produto, disponiveis, reservadas, emprestadas, origem)
            SELECT p.id_produto, p.estoque_total,
                COALESCE(sum(i.qnt_solicitada - i.qnt_devolvida) FILTER (WHERE o.id_status BETWEEN 1 AND 4), 0),
                COALESCE(sum(i.qnt_solicitada - i.qnt_devolvida) FILTER (WHERE o.id_status = 5), 0), 'inicio'
            FROM produto p LEFT JOIN contem_lista i USING (id_produto) LEFT JOIN pedido o USING (id_pedido) GROUP BY p.id_produto`;
        const summary = {};
        for (const table of tables) summary[table] = (await db`SELECT count(*)::int AS total FROM ${db(table)}`)[0].total;
        assert.equal(summary.produto, products);
        assert.equal(summary.usuario, users + operators.length);
        assert.equal(summary.pedido, orders);
        assert.equal(summary.contem_lista, orders * 3);
        assert.equal(summary.notificacao, notifications);
        assert.equal(summary.notificar, summary.notificacao_email);
        assert.equal((await db`SELECT count(*)::int AS invalid FROM contem_lista WHERE qnt_devolvida > qnt_solicitada OR qnt_danificada > qnt_devolvida`)[0].invalid, 0);
        assert.equal((await db`SELECT count(*)::int AS invalid FROM (SELECT id_usuario FROM pedido WHERE id_status BETWEEN 1 AND 5 GROUP BY id_usuario HAVING count(*) > 3) excessive`)[0].invalid, 0);
        return summary;
    });
    for (const table of tables) await sql`ANALYZE ${sql(table)}`;
    console.log(JSON.stringify({ database: url.pathname.slice(1), fictitious: true, counts }, null, 2));
} finally {
    await sql.end();
}
