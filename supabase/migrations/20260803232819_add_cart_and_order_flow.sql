begin;

alter table public.pedido
  add column if not exists duracao_dias smallint;

update public.pedido
set duracao_dias = 15
where duracao_dias is null;

alter table public.pedido
  alter column duracao_dias set default 15,
  alter column duracao_dias set not null;

alter table public.renovacao
  alter column justificativa_estendimento type text
  using justificativa_estendimento::text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pedido_duracao_dias_check'
      and conrelid = 'public.pedido'::regclass
  ) then
    alter table public.pedido
      add constraint pedido_duracao_dias_check
      check (duracao_dias between 1 and 15);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'produto_estoque_total_check'
      and conrelid = 'public.produto'::regclass
  ) then
    alter table public.produto
      add constraint produto_estoque_total_check
      check (estoque_total >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'lista_de_desejos_quantidade_check'
      and conrelid = 'public.lista_de_desejos'::regclass
  ) then
    alter table public.lista_de_desejos
      add constraint lista_de_desejos_quantidade_check
      check (quantidade > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'contem_lista_quantidades_check'
      and conrelid = 'public.contem_lista'::regclass
  ) then
    alter table public.contem_lista
      add constraint contem_lista_quantidades_check
      check (
        qnt_solicitada > 0
        and qnt_devolvida >= 0
        and qnt_devolvida <= qnt_solicitada
      );
  end if;
end $$;

insert into public.status_pedido (descricao_status)
select required_status
from (
  values
    ('Pendente'),
    ('Aprovado'),
    ('Em separação'),
    ('Pronto para retirada'),
    ('Retirado'),
    ('Devolvido'),
    ('Negado'),
    ('Cancelado')
) as statuses(required_status)
where not exists (
  select 1
  from public.status_pedido existing_status
  where lower(existing_status.descricao_status) = lower(required_status)
);

with duplicate_statuses as (
  select
    id_status,
    min(id_status) over (partition by lower(descricao_status)) as canonical_id
  from public.status_pedido
)
update public.pedido pedido
set id_status = duplicate_statuses.canonical_id
from duplicate_statuses
where pedido.id_status = duplicate_statuses.id_status
  and duplicate_statuses.id_status <> duplicate_statuses.canonical_id;

delete from public.status_pedido status
using (
  select
    id_status,
    min(id_status) over (partition by lower(descricao_status)) as canonical_id
  from public.status_pedido
) duplicate_statuses
where status.id_status = duplicate_statuses.id_status
  and duplicate_statuses.id_status <> duplicate_statuses.canonical_id;

create unique index if not exists status_pedido_descricao_lower_key
  on public.status_pedido (lower(descricao_status));

alter table public.categoria enable row level security;
alter table public.status_produto enable row level security;
alter table public.status_pedido enable row level security;
alter table public.notificacao enable row level security;
alter table public.produto enable row level security;
alter table public.pedido enable row level security;
alter table public.renovacao enable row level security;
alter table public.log_auditoria enable row level security;
alter table public.notificar enable row level security;
alter table public.lista_de_desejos enable row level security;
alter table public.contem_lista enable row level security;
alter table public.categorizar enable row level security;
alter table public.renovacao_pedido enable row level security;

-- O CHIP acessa estas tabelas apenas pelo backend. As políticas legadas de
-- perfil ficam redundantes depois da revogação do Data API e geram alertas de
-- performance nos advisors do Supabase.
drop policy if exists "Users can view their own profile" on public.usuario;
drop policy if exists "Users can update their own profile" on public.usuario;
drop policy if exists "Users can create their own profile" on public.usuario;

revoke all privileges on table
  public.usuario,
  public.categoria,
  public.status_produto,
  public.status_pedido,
  public.notificacao,
  public.produto,
  public.pedido,
  public.renovacao,
  public.log_auditoria,
  public.notificar,
  public.lista_de_desejos,
  public.contem_lista,
  public.categorizar,
  public.renovacao_pedido
from anon, authenticated;

commit;
