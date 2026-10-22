import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sql from '../backend/db.js';
import { CURRENT_TERMS_VERSION } from '../backend/services/orderRules.js';
import { recordInventoryUsage } from '../backend/services/inventoryUsage.js';

const marker = 'DEMO CHIP — cinco pedidos para visualizar o Kanban';
const names = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa'];
const statuses = ['Pendente', 'Aprovado', 'Em separação', 'Pronto para retirada', 'Retirado'];

try {
    const host = new URL(process.env.DATABASE_URL).hostname;
    assert.ok(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(host), 'A demonstração exige banco local fora de produção.');
    const existing = await sql`SELECT pedido.id_pedido, descricao_status AS status
        FROM pedido JOIN status_pedido USING (id_status) WHERE justificativa = ${marker} ORDER BY id_pedido`;
    if (existing.length) {
        assert.equal(existing.length, 5, 'Demonstração incompleta: confira os registros antes de criar mais.');
        console.log('Os cinco pedidos DEMO já existem:', existing);
    } else {
        const photo = `data:image/png;base64,${(await readFile(new URL('../frontend/assets/electronic_components_1_1774913851066.png', import.meta.url))).toString('base64')}`;
        const created = await sql.begin(async db => {
            const [available] = await db`SELECT id_statusproduto FROM status_produto WHERE status_produto = 'Disponível' LIMIT 1`;
            assert.ok(available, 'Execute o setup do banco antes de criar a demonstração.');
            const [product] = await db`INSERT INTO produto (nome, descricao_produto, estoque_total, cor, foto_produto, id_statusproduto)
                VALUES ('Kit de prototipagem DEMO', 'Item fictício para demonstração do Kanban e das devoluções.', 30, 'Azul', ${photo}, ${available.id_statusproduto}) RETURNING id_produto`;
            let [category] = await db`SELECT id_categoria FROM categoria WHERE lower(nome_categoria) = 'demonstração' LIMIT 1`;
            if (!category) [category] = await db`INSERT INTO categoria (nome_categoria) VALUES ('Demonstração') RETURNING id_categoria`;
            await db`INSERT INTO categorizar (id_categoria, id_produto) VALUES (${category.id_categoria}, ${product.id_produto})`;
            const orders = [];
            for (let index = 0; index < 5; index++) {
                // Perfis fictícios não têm identidade Google nem sessão para entrar no sistema.
                const [student] = await db`INSERT INTO usuario (nome, email, auth_provider, nivel_acesso)
                    VALUES (${`${names[index]} — DEMO`}, ${`demo.chip.${names[index].toLowerCase()}@example.invalid`}, 'demo', 0) RETURNING id_usuario`;
                const [status] = await db`SELECT id_status FROM status_pedido WHERE descricao_status = ${statuses[index]} LIMIT 1`;
                assert.ok(status, `Status ausente: ${statuses[index]}`);
                const [order] = await db`INSERT INTO pedido (id_usuario, id_status, duracao_dias, estado_termo, timestamp_termo, versao_termo, justificativa, data_aprovacao, data_retirada)
                    VALUES (${student.id_usuario}, ${status.id_status}, 7, true, now(), ${CURRENT_TERMS_VERSION}, ${marker},
                        CASE WHEN ${index > 0} THEN current_date ELSE NULL END,
                        CASE WHEN ${index === 4} THEN current_date ELSE NULL END) RETURNING id_pedido`;
                await db`INSERT INTO contem_lista (id_pedido, id_produto, qnt_solicitada) VALUES (${order.id_pedido}, ${product.id_produto}, ${index + 1})`;
                await db`INSERT INTO log_auditoria (acao, tabela_afetada, dados_posteriores)
                    VALUES ('pedido:demo_seed', 'pedido', ${JSON.stringify({ id_pedido: order.id_pedido, status: statuses[index], demonstracao: true })})`;
                orders.push({ id_pedido: order.id_pedido, status: statuses[index], quantidade: index + 1 });
            }
            await db`UPDATE produto SET estoque_total = estoque_total - 15 WHERE id_produto = ${product.id_produto}`;
            await recordInventoryUsage(db, [product.id_produto], 'inicio');
            const [check] = await db`SELECT count(*)::int AS total, count(DISTINCT id_status)::int AS etapas FROM pedido WHERE justificativa = ${marker}`;
            assert.equal(check.total, 5);
            assert.equal(check.etapas, 5);
            assert.equal((await db`SELECT estoque_total FROM produto WHERE id_produto = ${product.id_produto}`)[0].estoque_total, 15);
            return orders;
        });
        console.log('Cinco pedidos DEMO criados, sem alterar o estoque dos produtos existentes:', created);
    }
} finally {
    await sql.end();
}
