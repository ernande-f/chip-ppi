-- ============================================================
-- CHIP-PPI — Índices de Performance
-- Otimização para buscas frequentes, ordenações e relacionamentos
-- ============================================================

-- 1. Usuários: Busca rápida por e-mail normalizado e auth_user_id
CREATE INDEX IF NOT EXISTS idx_usuario_email_lower
    ON public.usuario (lower(email));

CREATE INDEX IF NOT EXISTS idx_usuario_auth_user_id
    ON public.usuario (auth_user_id);

-- 2. Pedidos: Listagens ordenadas por usuário e por status
CREATE INDEX IF NOT EXISTS idx_pedido_usuario_data
    ON public.pedido (id_usuario, data_pedido DESC, id_pedido DESC);

CREATE INDEX IF NOT EXISTS idx_pedido_status_data
    ON public.pedido (id_status, data_pedido DESC, id_pedido DESC);

-- 3. Itens do Pedido: Junção rápida entre pedidos e produtos
CREATE INDEX IF NOT EXISTS idx_contem_lista_pedido
    ON public.contem_lista (id_pedido);

CREATE INDEX IF NOT EXISTS idx_contem_lista_produto
    ON public.contem_lista (id_produto);

-- 4. Categorização: Filtros e agregações do catálogo de produtos
CREATE INDEX IF NOT EXISTS idx_categorizar_produto
    ON public.categorizar (id_produto);

CREATE INDEX IF NOT EXISTS idx_categorizar_categoria
    ON public.categorizar (id_categoria);

-- 5. Produtos: Ordenação alfabética e filtro por status/estoque
CREATE INDEX IF NOT EXISTS idx_produto_nome_lower
    ON public.produto (lower(nome));

CREATE INDEX IF NOT EXISTS idx_produto_status_estoque
    ON public.produto (id_statusproduto, estoque_total);
