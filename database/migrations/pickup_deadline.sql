BEGIN;
ALTER TABLE public.pedido ADD COLUMN IF NOT EXISTS data_aprovacao date;
-- Pedidos já aprovados sem data registrada recebem os dez dias a partir da atualização.
UPDATE public.pedido SET data_aprovacao = current_date
WHERE data_aprovacao IS NULL AND data_retirada IS NULL
  AND id_status IN (
    SELECT id_status FROM public.status_pedido
    WHERE descricao_status IN ('Aprovado', 'Em separação', 'Pronto para retirada')
  );
INSERT INTO public.status_pedido (descricao_status)
SELECT 'Expirado' WHERE NOT EXISTS (
    SELECT 1 FROM public.status_pedido WHERE lower(descricao_status) = 'expirado'
);
-- A expiração é uma ação do sistema, sem atribuí-la a um usuário.
ALTER TABLE public.log_auditoria ALTER COLUMN id_usuario DROP NOT NULL;
-- As antigas datas de agendamento são mantidas apenas como histórico.
COMMIT;
