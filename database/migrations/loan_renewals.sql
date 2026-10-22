begin;

alter table renovacao add column if not exists status varchar(20) not null default 'Pendente';
alter table renovacao add column if not exists id_decisor bigint references usuario(id_usuario);
update renovacao set status = case when motivo_recusa is null then 'Aprovada' else 'Negada' end
where data_resposta is not null and status = 'Pendente';
do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'renovacao_status_check') then
        alter table renovacao add constraint renovacao_status_check check (status in ('Pendente', 'Aprovada', 'Negada', 'Cancelada'));
    end if;
end $$;
create unique index if not exists renovacao_pedido_unico on renovacao_pedido(id_renovacao);

commit;
