BEGIN;
CREATE TABLE IF NOT EXISTS historico_uso_estoque (
    id_registro bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_produto bigint NOT NULL REFERENCES produto(id_produto),
    registrado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
    disponiveis integer NOT NULL CHECK (disponiveis >= 0),
    reservadas bigint NOT NULL CHECK (reservadas >= 0),
    emprestadas bigint NOT NULL CHECK (emprestadas >= 0),
    origem text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_historico_uso_produto_registro
    ON historico_uso_estoque(id_produto, id_registro DESC);
CREATE INDEX IF NOT EXISTS idx_historico_uso_data ON historico_uso_estoque(registrado_em);

-- O primeiro retrato observa o estoque de agora; não reconstitui movimentos anteriores.
LOCK TABLE produto IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO historico_uso_estoque (id_produto, disponiveis, reservadas, emprestadas, origem)
SELECT produto.id_produto, produto.estoque_total,
    COALESCE(sum(item.qnt_solicitada - item.qnt_devolvida) FILTER (
        WHERE status.descricao_status IN ('Pendente', 'Aprovado', 'Em separação', 'Pronto para retirada')
    ), 0),
    COALESCE(sum(item.qnt_solicitada - item.qnt_devolvida) FILTER (
        WHERE status.descricao_status = 'Retirado'
    ), 0), 'inicio'
FROM produto
LEFT JOIN contem_lista item USING (id_produto)
LEFT JOIN pedido USING (id_pedido)
LEFT JOIN status_pedido status USING (id_status)
WHERE NOT EXISTS (SELECT 1 FROM historico_uso_estoque historico WHERE historico.id_produto = produto.id_produto)
GROUP BY produto.id_produto, produto.estoque_total
ORDER BY produto.id_produto;

ALTER TABLE historico_uso_estoque ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON historico_uso_estoque FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON historico_uso_estoque FROM %I', api_role);
        END IF;
    END LOOP;
END $$;
COMMIT;
