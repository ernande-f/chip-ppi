-- ============================================================
-- CHIP-PPI — Criação de tabelas no Supabase
-- Baseado no modelo lógico (ER) do projeto
-- Execute este script inteiro no SQL Editor do Supabase
-- ============================================================

-- ============================================================
-- 1. TABELAS BASE (sem dependências)
-- ============================================================

-- Categorias de produtos
create table if not exists categoria (
  id_categoria bigint generated always as identity primary key,
  nome_categoria varchar(100) not null
);

-- Status possíveis para um produto
create table if not exists status_produto (
  id_statusproduto bigint generated always as identity primary key,
  status_produto varchar(50) not null
);

-- Status possíveis para um pedido
create table if not exists status_pedido (
  id_status bigint generated always as identity primary key,
  descricao_status varchar(100) not null
);

-- Notificações do sistema
create table if not exists notificacao (
  id_notificacao bigint generated always as identity primary key,
  mensagem text not null,
  data_notificacao date not null default current_date,
  foi_lida boolean not null default false
);

-- ============================================================
-- 2. TABELAS PRINCIPAIS (dependem das tabelas base)
-- ============================================================

-- Usuários do sistema
create table if not exists usuario (
  id_usuario bigint generated always as identity primary key,
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  nome varchar(60) not null,
  cpf text unique,
  email varchar(60) not null unique,
  senha varchar(80),
  status_conta boolean not null default true,
  motivo_bloqueio text,
  data_bloqueio timestamptz,
  nivel_acesso int not null default 0,
  tmp_senha varchar(80),
  dias_bloqueio int default 0
);

-- Produtos disponíveis
create table if not exists produto (
  id_produto bigint generated always as identity primary key,
  foto_produto varchar(1024),
  descricao_produto text,
  nome varchar(50) not null,
  estoque_total int not null default 0,
  cor varchar(20),
  id_statusproduto bigint not null references status_produto(id_statusproduto)
);

-- Pedidos de produtos
create table if not exists pedido (
  id_pedido bigint generated always as identity primary key,
  data_pedido date not null default current_date,
  data_retirada date,
  data_devolucao date,
  estado_termo boolean not null default false,
  timestamp_termo timestamptz,
  versao_termo int,
  motivo_recusa text,
  id_usuario bigint not null references usuario(id_usuario),
  id_status bigint not null references status_pedido(id_status)
);

-- Renovações de pedido
create table if not exists renovacao (
  id_renovacao bigint generated always as identity primary key,
  data_estendida date,
  justificativa_estendimento int,
  data_solicitacao date not null default current_date,
  data_resposta date,
  motivo_recusa text
);

-- Logs de auditoria
create table if not exists log_auditoria (
  id_log bigint generated always as identity primary key,
  "timestamp" timestamptz not null default now(),
  acao text not null,
  tabela_afetada text,
  dados_anteriores text,
  ip text,
  dados_posteriores text,
  id_usuario bigint not null references usuario(id_usuario)
);

-- ============================================================
-- 3. TABELAS DE RELACIONAMENTO (N:N)
-- ============================================================

-- Relacionamento Usuário ↔ Notificação (N:N)
create table if not exists notificar (
  id_usuario bigint not null references usuario(id_usuario),
  id_notificacao bigint not null references notificacao(id_notificacao),
  primary key (id_usuario, id_notificacao)
);

-- Lista de desejos (Usuário ↔ Produto)
create table if not exists lista_de_desejos (
  id_produto bigint not null references produto(id_produto),
  id_usuario bigint not null references usuario(id_usuario),
  quantidade int not null default 1,
  data_adicao date not null default current_date,
  primary key (id_produto, id_usuario)
);

-- Itens de um pedido (Pedido ↔ Produto)
create table if not exists contem_lista (
  id_pedido bigint not null references pedido(id_pedido),
  id_produto bigint not null references produto(id_produto),
  qnt_solicitada int not null default 1,
  qnt_devolvida int not null default 0,
  status_item text,
  primary key (id_pedido, id_produto)
);

-- Categorização de produtos (Produto ↔ Categoria)
create table if not exists categorizar (
  id_categoria bigint not null references categoria(id_categoria),
  id_produto bigint not null references produto(id_produto),
  primary key (id_categoria, id_produto)
);

-- Relacionamento Renovação ↔ Pedido (N:N)
create table if not exists renovacao_pedido (
  id_renovacao bigint not null references renovacao(id_renovacao),
  id_pedido bigint not null references pedido(id_pedido),
  primary key (id_renovacao, id_pedido)
);

-- ============================================================
-- 4. ÍNDICES EM FOREIGN KEYS
-- Postgres NÃO cria índices automaticamente em FKs.
-- Índices melhoram JOINs e CASCADE 10-100x.
-- ============================================================

-- Produto
create index if not exists idx_produto_statusproduto on produto(id_statusproduto);

-- Pedido
create index if not exists idx_pedido_usuario on pedido(id_usuario);
create index if not exists idx_usuario_auth_user_id on usuario(auth_user_id);
create index if not exists idx_pedido_status on pedido(id_status);

-- Log de auditoria
create index if not exists idx_log_auditoria_usuario on log_auditoria(id_usuario);

-- Notificar (tabela de junção — PKs compostas já indexam a 1ª coluna)
create index if not exists idx_notificar_notificacao on notificar(id_notificacao);

-- Lista de desejos
create index if not exists idx_lista_desejos_usuario on lista_de_desejos(id_usuario);

-- Contem lista
create index if not exists idx_contem_lista_produto on contem_lista(id_produto);

-- Categorizar
create index if not exists idx_categorizar_produto on categorizar(id_produto);

-- Renovação pedido
create index if not exists idx_renovacao_pedido_pedido on renovacao_pedido(id_pedido);

-- ============================================================
-- 5. RLS BÁSICO PARA PERFIL
-- ============================================================

alter table public.usuario enable row level security;

drop policy if exists "Users can view their own profile" on public.usuario;
create policy "Users can view their own profile"
  on public.usuario
  for select
  to authenticated
  using (auth.uid() = auth_user_id);

drop policy if exists "Users can update their own profile" on public.usuario;
create policy "Users can update their own profile"
  on public.usuario
  for update
  to authenticated
  using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);

drop policy if exists "Users can create their own profile" on public.usuario;
create policy "Users can create their own profile"
  on public.usuario
  for insert
  to authenticated
  with check (auth.uid() = auth_user_id);
