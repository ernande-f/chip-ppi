BEGIN;
ALTER TABLE public.usuario DROP CONSTRAINT IF EXISTS usuario_auth_user_id_fkey;
ALTER TABLE public.usuario ADD COLUMN IF NOT EXISTS google_sub text UNIQUE;
ALTER TABLE public.usuario ALTER COLUMN email TYPE varchar(320);
CREATE UNIQUE INDEX IF NOT EXISTS usuario_email_lower_key ON public.usuario (lower(email));
COMMIT;
