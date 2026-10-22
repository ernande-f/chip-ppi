-- Unidades recebidas com danos não voltam ao estoque disponível.
BEGIN;
ALTER TABLE public.contem_lista ADD COLUMN IF NOT EXISTS qnt_danificada int NOT NULL DEFAULT 0;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.contem_lista'::regclass AND conname = 'contem_lista_danos_check'
    ) THEN
        ALTER TABLE public.contem_lista ADD CONSTRAINT contem_lista_danos_check
            CHECK (qnt_danificada >= 0 AND qnt_danificada <= qnt_devolvida);
    END IF;
END $$;
COMMIT;
