begin;

-- O logout invalida sessões antigas sem apagar perfis ou histórico.
alter table public.usuario
  add column if not exists session_version integer not null default 0 check (session_version >= 0);

commit;
