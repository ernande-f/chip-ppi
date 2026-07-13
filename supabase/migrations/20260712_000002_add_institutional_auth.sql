begin;

-- Um usuário institucional não possui, necessariamente, uma conta em auth.users.
-- O UUID continua sendo a identidade interna do CHIP, sem depender do Supabase.
alter table public.usuario
  drop constraint if exists usuario_auth_user_id_fkey;

alter table public.usuario
  alter column email drop not null;

alter table public.usuario
  add column if not exists auth_provider varchar(20) not null default 'supabase',
  add column if not exists institutional_auth_type varchar(1);

alter table public.usuario
  drop constraint if exists usuario_institutional_auth_type_check;

alter table public.usuario
  add constraint usuario_institutional_auth_type_check
  check (institutional_auth_type is null or institutional_auth_type in ('L', 'S'));

update public.usuario
set auth_provider = 'supabase'
where auth_provider is null or auth_provider = '';

create index if not exists idx_usuario_cpf on public.usuario (cpf)
where cpf is not null;

commit;
