begin;

-- Fotos em data URL ultrapassam facilmente varchar(1024).
alter table public.produto
  alter column foto_produto type text;

-- Estados usados pelo catálogo. O serviço também os garante para instalações novas.
insert into public.status_produto (status_produto)
select required_status
from (values ('Disponível'), ('Indisponível'), ('Arquivado')) as statuses(required_status)
where not exists (
  select 1
  from public.status_produto existing_status
  where lower(existing_status.status_produto) = lower(required_status)
);

-- Itens legados passam a aparecer no novo catálogo conforme o estoque atual.
update public.produto product
set id_statusproduto = case
  when product.estoque_total > 0 then (
    select id_statusproduto
    from public.status_produto
    where lower(status_produto) = lower('Disponível')
    limit 1
  )
  else (
    select id_statusproduto
    from public.status_produto
    where lower(status_produto) = lower('Indisponível')
    limit 1
  )
end
where not exists (
  select 1
  from public.status_produto current_status
  where current_status.id_statusproduto = product.id_statusproduto
    and lower(current_status.status_produto) = lower('Arquivado')
);

create index if not exists idx_produto_nome_lower on public.produto (lower(nome));
create index if not exists idx_produto_cor_lower on public.produto (lower(cor));
create index if not exists idx_categoria_nome_lower on public.categoria (lower(nome_categoria));

commit;
