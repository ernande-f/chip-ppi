import {
    addItemCarrinho,
    getCategorias,
    getInitials,
    getPedidos,
    getProdutos,
    getSession
} from './api.js';

const FALLBACK_IMAGE = '../assets/electronic_components_1_1774913851066.png';

function createProductCard(product) {
    const card = document.createElement('article');
    card.className = 'card item-card';

    const image = document.createElement('div');
    image.className = 'item-image';
    const imageElement = document.createElement('img');
    imageElement.src = product.foto_produto || FALLBACK_IMAGE;
    imageElement.alt = `Foto de ${product.nome}`;
    imageElement.loading = 'lazy';
    image.appendChild(imageElement);

    const info = document.createElement('div');
    info.className = 'item-info';

    const title = document.createElement('h3');
    title.textContent = product.nome;
    info.appendChild(title);

    const description = document.createElement('p');
    description.className = 'desc';
    description.textContent = product.descricao_produto;
    info.appendChild(description);

    const quantity = document.createElement('p');
    quantity.textContent = `Disponível: ${product.estoque_total} un.`;
    info.appendChild(quantity);

    const metadata = document.createElement('p');
    const categories = Array.isArray(product.categorias) ? product.categorias.join(', ') : '';
    metadata.textContent = `${categories || 'Sem categoria'}${product.cor ? ` · ${product.cor}` : ''}`;
    info.appendChild(metadata);

    const addButton = document.createElement('button');
    addButton.className = 'add-btn';
    addButton.type = 'button';
    addButton.title = 'Adicionar ao carrinho';
    addButton.textContent = '+';
    addButton.addEventListener('click', async () => {
        addButton.disabled = true;

        try {
            await addItemCarrinho(product.id_produto, 1);
            addButton.textContent = '✓';
            setTimeout(() => {
                addButton.textContent = '+';
            }, 1200);
        } catch (error) {
            alert(error.message || 'Não foi possível adicionar o item ao carrinho.');
        } finally {
            addButton.disabled = false;
        }
    });
    info.appendChild(addButton);

    card.append(image, info);
    return card;
}

function getStatusClass(status) {
    if (status === 'Pendente') return 'yellow';
    if (status === 'Negado' || status === 'Cancelado') return 'red';
    return 'green';
}

function renderRecentOrders(container, orders) {
    container.replaceChildren();

    if (!orders || orders.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'catalog-empty';
        empty.textContent = 'Você ainda não fez nenhum pedido.';
        container.appendChild(empty);
        return;
    }

    orders.slice(0, 3).forEach((order) => {
        const card = document.createElement('a');
        card.className = 'card order-card';
        card.href = '/pedidos';

        const identifier = document.createElement('span');
        identifier.className = 'order-id';
        identifier.textContent = `Pedido #${order.id_pedido}`;

        const status = document.createElement('span');
        status.className = `status ${getStatusClass(order.status)}`;
        status.textContent = order.status;
        card.append(identifier, status);
        container.appendChild(card);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    const searchInput = document.getElementById('catalogSearch');
    const categorySelect = document.getElementById('catalogCategory');
    const grid = document.getElementById('catalogGrid');
    const recentOrders = document.getElementById('recentOrders');
    const headerAvatar = document.getElementById('headerAvatar');
    let debounce;

    let currentPage = 1;
    let hasMore = true;
    let isLoading = false;
    const PAGE_LIMIT = 20;

    const sentinel = document.createElement('div');
    sentinel.id = 'catalogSentinel';
    sentinel.style.gridColumn = '1 / -1';
    sentinel.style.height = '40px';
    sentinel.style.display = 'flex';
    sentinel.style.alignItems = 'center';
    sentinel.style.justifyContent = 'center';

    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
            loadCatalog(false);
        }
    }, { rootMargin: '200px' });

    async function loadCatalog(reset = true) {
        if (isLoading) return;
        if (!reset && !hasMore) return;

        isLoading = true;

        if (reset) {
            currentPage = 1;
            hasMore = true;
            grid.replaceChildren();
        }

        sentinel.textContent = 'Carregando itens...';
        grid.appendChild(sentinel);

        try {
            const products = await getProdutos({
                search: searchInput.value.trim(),
                category: categorySelect.value,
                availableOnly: true,
                page: currentPage,
                limit: PAGE_LIMIT
            });

            sentinel.remove();

            if (reset && products.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'catalog-empty';
                empty.textContent = 'Nenhum item disponível corresponde à sua pesquisa.';
                grid.appendChild(empty);
                hasMore = false;
                return;
            }

            products.forEach((product) => grid.appendChild(createProductCard(product)));

            hasMore = products.hasMore ?? (products.length === PAGE_LIMIT);
            currentPage++;

            if (hasMore) {
                grid.appendChild(sentinel);
                observer.observe(sentinel);
            }
        } catch (error) {
            console.error('Erro ao carregar catálogo:', error);
            sentinel.remove();
            if (reset) {
                grid.replaceChildren();
                const message = document.createElement('p');
                message.className = 'catalog-empty catalog-error';
                message.textContent = error.message || 'Não foi possível carregar o catálogo.';
                grid.appendChild(message);
            }
        } finally {
            isLoading = false;
        }
    }

    async function loadRecentOrders(profile) {
        try {
            if (profile?.recentOrders) {
                renderRecentOrders(recentOrders, profile.recentOrders);
            } else {
                renderRecentOrders(recentOrders, await getPedidos());
            }
        } catch (error) {
            console.error('Erro ao carregar pedidos recentes:', error);
            recentOrders.replaceChildren();
            const message = document.createElement('p');
            message.className = 'catalog-empty catalog-error';
            message.textContent = 'Não foi possível carregar os pedidos recentes.';
            recentOrders.appendChild(message);
        }
    }

    try {
        const [{ profile, user }, categories] = await Promise.all([getSession(), getCategorias()]);
        headerAvatar.textContent = getInitials(profile?.nome || user?.user_metadata?.name || user?.email);

        categories.forEach((category) => {
            const option = document.createElement('option');
            option.value = category.nome_categoria;
            option.textContent = category.nome_categoria;
            categorySelect.appendChild(option);
        });

        await Promise.all([loadCatalog(true), loadRecentOrders(profile)]);
    } catch (error) {
        console.error('Erro ao preparar catálogo:', error);
        window.location.href = '/login';
        return;
    }

    searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => loadCatalog(true), 250);
    });
    categorySelect.addEventListener('change', () => loadCatalog(true));
});
