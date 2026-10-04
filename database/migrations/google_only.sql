begin;

-- Instalações antigas mantêm seus perfis; o primeiro login Google cria o vínculo.
alter table public.usuario
  add column if not exists auth_provider varchar(20) not null default 'google';
alter table public.usuario alter column auth_provider set default 'google';

-- Fotos novas e as importadas ficam no próprio PostgreSQL.
alter table public.produto alter column foto_produto type text;
alter table public.pedido add column if not exists justificativa text;

commit;
