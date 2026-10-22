BEGIN;
ALTER TABLE notificacao ADD COLUMN IF NOT EXISTS criada_em timestamptz NOT NULL DEFAULT now();
UPDATE notificacao SET criada_em = data_notificacao::timestamptz WHERE data_notificacao < criada_em::date;
ALTER TABLE notificacao ADD COLUMN IF NOT EXISTS href text NOT NULL DEFAULT '/pedidos';
ALTER TABLE notificacao ADD COLUMN IF NOT EXISTS chave_evento text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notificacao_evento ON notificacao(chave_evento);
ALTER TABLE notificar ADD COLUMN IF NOT EXISTS lida_em timestamptz;
UPDATE notificar SET lida_em = notificacao.criada_em FROM notificacao
WHERE notificar.id_notificacao = notificacao.id_notificacao AND notificacao.foi_lida AND notificar.lida_em IS NULL;
CREATE TABLE IF NOT EXISTS notificacao_email (
    id_notificacao bigint NOT NULL,
    id_usuario bigint NOT NULL,
    estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente','enviando','enviado','falha','desativado')),
    tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
    disponivel_em timestamptz NOT NULL DEFAULT now(),
    reservado_em timestamptz,
    enviado_em timestamptz,
    ultimo_erro text,
    PRIMARY KEY (id_notificacao,id_usuario),
    FOREIGN KEY (id_usuario,id_notificacao) REFERENCES notificar(id_usuario,id_notificacao)
);
CREATE INDEX IF NOT EXISTS idx_notificacao_email_fila ON notificacao_email(estado,disponivel_em);
ALTER TABLE notificacao_email ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notificacao_email FROM PUBLIC;
COMMIT;
