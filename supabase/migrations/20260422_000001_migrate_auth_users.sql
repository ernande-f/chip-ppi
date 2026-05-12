begin;

create extension if not exists pgcrypto;

alter table public.usuario
  add column if not exists auth_user_id uuid;

alter table public.usuario
  alter column cpf type text,
  alter column cpf drop not null,
  alter column senha drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'usuario_auth_user_id_fkey'
      and conrelid = 'public.usuario'::regclass
  ) then
    alter table public.usuario
      add constraint usuario_auth_user_id_fkey
      foreign key (auth_user_id)
      references auth.users(id)
      on delete cascade;
  end if;
end $$;

create unique index if not exists usuario_auth_user_id_key
  on public.usuario (auth_user_id)
  where auth_user_id is not null;

update public.usuario u
set auth_user_id = au.id
from auth.users au
where u.auth_user_id is null
  and lower(u.email) = lower(au.email);

insert into public.usuario (auth_user_id, nome, email, cpf, status_conta, nivel_acesso)
select
  au.id,
  coalesce(nullif(trim(au.raw_user_meta_data ->> 'name'), ''), split_part(au.email, '@', 1)),
  lower(au.email),
  null,
  true,
  0
from auth.users au
left join public.usuario u
  on u.auth_user_id = au.id
  or lower(u.email) = lower(au.email)
where u.id_usuario is null;

create or replace function public.sync_usuario_with_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  update public.usuario
  set
    auth_user_id = coalesce(public.usuario.auth_user_id, new.id),
    email = lower(new.email),
    nome = case
      when public.usuario.nome is null or public.usuario.nome = ''
        then coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1))
      else public.usuario.nome
    end,
    status_conta = coalesce(public.usuario.status_conta, true)
  where public.usuario.auth_user_id = new.id
     or lower(public.usuario.email) = lower(new.email);

  if not found then
    insert into public.usuario (auth_user_id, nome, email, status_conta, nivel_acesso)
    values (
      new.id,
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
      lower(new.email),
      true,
      0
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_synced_to_usuario on auth.users;

create trigger on_auth_user_synced_to_usuario
after insert or update on auth.users
for each row execute function public.sync_usuario_with_auth_user();

alter table public.usuario enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'usuario'
      and policyname = 'Users can view their own profile'
  ) then
    create policy "Users can view their own profile"
      on public.usuario
      for select
      to authenticated
      using (auth.uid() = auth_user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'usuario'
      and policyname = 'Users can update their own profile'
  ) then
    create policy "Users can update their own profile"
      on public.usuario
      for update
      to authenticated
      using (auth.uid() = auth_user_id)
      with check (auth.uid() = auth_user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'usuario'
      and policyname = 'Users can create their own profile'
  ) then
    create policy "Users can create their own profile"
      on public.usuario
      for insert
      to authenticated
      with check (auth.uid() = auth_user_id);
  end if;
end $$;

commit;
