BEGIN;
ALTER TABLE public.pedido
    ADD COLUMN IF NOT EXISTS retirada_prevista date,
    ADD COLUMN IF NOT EXISTS devolucao_prevista date;
ALTER TABLE public.pedido DROP CONSTRAINT IF EXISTS pedido_reserva_datas_check;
ALTER TABLE public.pedido ADD CONSTRAINT pedido_reserva_datas_check CHECK (
    (retirada_prevista IS NULL AND devolucao_prevista IS NULL) OR
    (retirada_prevista IS NOT NULL AND devolucao_prevista IS NOT NULL AND
     devolucao_prevista - retirada_prevista BETWEEN 1 AND 15)
);
COMMIT;
