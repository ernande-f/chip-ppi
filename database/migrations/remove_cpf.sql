BEGIN;

ALTER TABLE public.usuario DROP COLUMN IF EXISTS cpf;

CREATE OR REPLACE FUNCTION pg_temp.without_cpf(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
    CASE jsonb_typeof(payload)
        WHEN 'object' THEN
            RETURN (SELECT COALESCE(jsonb_object_agg(key, pg_temp.without_cpf(value)), '{}'::jsonb)
                FROM jsonb_each(payload) WHERE lower(key) <> 'cpf');
        WHEN 'array' THEN
            RETURN (SELECT COALESCE(jsonb_agg(pg_temp.without_cpf(value) ORDER BY position), '[]'::jsonb)
                FROM jsonb_array_elements(payload) WITH ORDINALITY AS items(value, position));
        ELSE RETURN payload;
    END CASE;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.without_cpf_text(payload text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE original jsonb; cleaned jsonb;
BEGIN
    original := payload::jsonb;
    cleaned := pg_temp.without_cpf(original);
    RETURN CASE WHEN cleaned IS DISTINCT FROM original THEN cleaned::text ELSE payload END;
EXCEPTION WHEN data_exception THEN
    -- Logs antigos sem JSON estruturado não podem ser reescritos com segurança.
    RETURN payload;
END $$;

UPDATE public.log_auditoria
SET dados_anteriores = pg_temp.without_cpf_text(dados_anteriores),
    dados_posteriores = pg_temp.without_cpf_text(dados_posteriores)
WHERE dados_anteriores IS DISTINCT FROM pg_temp.without_cpf_text(dados_anteriores)
    OR dados_posteriores IS DISTINCT FROM pg_temp.without_cpf_text(dados_posteriores);

DROP FUNCTION pg_temp.without_cpf_text(text);
DROP FUNCTION pg_temp.without_cpf(jsonb);

COMMIT;
