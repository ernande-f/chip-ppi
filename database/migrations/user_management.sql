BEGIN;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS bloqueio_automatico_ate date;
CREATE TABLE IF NOT EXISTS penalidade_atraso (
    id_pedido bigint PRIMARY KEY REFERENCES pedido(id_pedido),
    id_usuario bigint NOT NULL REFERENCES usuario(id_usuario),
    data_prevista date NOT NULL,
    data_devolucao date NOT NULL,
    dias_bloqueio integer NOT NULL CHECK (dias_bloqueio > 0),
    inicio_bloqueio date NOT NULL,
    fim_bloqueio date NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_penalidade_atraso_usuario ON penalidade_atraso(id_usuario);
ALTER TABLE penalidade_atraso ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE penalidade_atraso FROM %I', api_role);
        END IF;
    END LOOP;
END $$;
COMMIT;
