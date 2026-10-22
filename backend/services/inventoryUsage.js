import { ORDER_STATUS } from './orderRules.js';

export async function recordInventoryUsage(db, productIds, origin) {
    if (!productIds.length) return;
    // A consulta seguinte precisa enxergar o commit de quem segurava a trava.
    await db`SELECT id_produto FROM produto WHERE id_produto IN ${db(productIds)}
        ORDER BY id_produto FOR UPDATE`;
    return db`
        WITH movimentos AS (
            SELECT item.id_produto,
                COALESCE(sum(item.qnt_solicitada - item.qnt_devolvida) FILTER (
                    WHERE status.descricao_status IN (${ORDER_STATUS.PENDING}, ${ORDER_STATUS.APPROVED},
                        ${ORDER_STATUS.SEPARATING}, ${ORDER_STATUS.READY})
                ), 0) AS reservadas,
                COALESCE(sum(item.qnt_solicitada - item.qnt_devolvida) FILTER (
                    WHERE status.descricao_status = ${ORDER_STATUS.PICKED_UP}
                ), 0) AS emprestadas
            FROM contem_lista item JOIN pedido USING (id_pedido) JOIN status_pedido status USING (id_status)
            WHERE item.id_produto IN ${db(productIds)}
            GROUP BY item.id_produto
        )
        INSERT INTO historico_uso_estoque (id_produto, disponiveis, reservadas, emprestadas, origem)
        SELECT produto.id_produto, produto.estoque_total,
            COALESCE(movimentos.reservadas, 0), COALESCE(movimentos.emprestadas, 0), ${origin}
        FROM produto LEFT JOIN movimentos USING (id_produto)
        LEFT JOIN LATERAL (
            SELECT disponiveis, reservadas, emprestadas FROM historico_uso_estoque
            WHERE id_produto = produto.id_produto ORDER BY id_registro DESC LIMIT 1
        ) anterior ON true
        WHERE produto.id_produto IN ${db(productIds)}
            AND ROW(produto.estoque_total, COALESCE(movimentos.reservadas, 0), COALESCE(movimentos.emprestadas, 0))
                IS DISTINCT FROM ROW(anterior.disponiveis, anterior.reservadas, anterior.emprestadas)
        ORDER BY produto.id_produto
        RETURNING id_registro
    `;
}
