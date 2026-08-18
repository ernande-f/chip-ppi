begin;

alter table public.pedido
  add column if not exists justificativa text;

commit;
