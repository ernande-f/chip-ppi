import {
    addItemCarrinho,
    getCategorias,
    getInitials,
    getPedidos,
    getProdutos,
    getSession
} from './api.js';

let signedIn = false;

const FALLBACK_IMAGE = '/assets/electronic_components_1_1774913851066.png';

function createProductCard(product) {
    const card = document.createElement('article');
    card.className = 'card item-card';

    const image = document.createElement('div');
    image.className = 'item-image';
    const imageElement = document.createElement('img');
    imageElement.src = product.foto_produto || FALLBACK_IMAGE;
    imageElement.alt = `Foto de ${product.nome}`;
    imageElement.loading = 'lazy';
    imageElement.referrerPolicy = 'no-referrer';
    imageElement.onerror = () => {
        imageElement.onerror = null;
        imageElement.src = FALLBACK_IMAGE;
    };
    image.appendChild(imageElement);

    const info = document.createElement('div');
    info.className = 'item-info';

    const title = document.createElement('h3');
    title.id = `product-title-${product.id_produto}`;
    title.textContent = product.nome;
    info.appendChild(title);

    const description = document.createElement('p');
    description.id = `product-description-${product.id_produto}`;
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

    const detailsButton = document.createElement('button');
    detailsButton.className = 'product-details-toggle';
    detailsButton.type = 'button';
    detailsButton.textContent = 'Ver detalhes';
    detailsButton.setAttribute('aria-label', `Ver detalhes de ${product.nome}`);
    detailsButton.setAttribute('aria-expanded', 'false');
    detailsButton.setAttribute('aria-controls', `${title.id} ${description.id}`);
    detailsButton.addEventListener('click', () => {
        const expanded = card.classList.toggle('is-expanded');
        detailsButton.setAttribute('aria-expanded', String(expanded));
        detailsButton.textContent = expanded ? 'Recolher detalhes' : 'Ver detalhes';
        detailsButton.setAttribute('aria-label', `${detailsButton.textContent} de ${product.nome}`);
    });
    info.appendChild(detailsButton);

    const addButton = document.createElement('button');
    addButton.className = 'add-btn';
    addButton.type = 'button';
    addButton.title = `${signedIn ? 'Adicionar ao carrinho' : 'Entre para solicitar este item'}: ${product.nome}`;
    addButton.setAttribute('aria-label', addButton.title);
    addButton.textContent = '+';
    const feedback = document.createElement('p');
    feedback.className = 'product-cart-feedback';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    feedback.setAttribute('aria-atomic', 'true');
    addButton.addEventListener('click', async () => {
        if (!signedIn) {
            window.location.href = '/login';
            return;
        }
        const hadFocus = document.activeElement === addButton;
        addButton.disabled = true;
        addButton.setAttribute('aria-label', `Adicionando ao carrinho: ${product.nome}`);
        addButton.textContent = '…';
        feedback.textContent = `Adicionando 1 unidade de ${product.nome}…`;

        try {
            await addItemCarrinho(product.id_produto, 1);
            const cartLink = document.createElement('a');
            cartLink.href = '/pedidos';
            cartLink.textContent = 'Ver carrinho';
            feedback.replaceChildren(document.createTextNode(`1 unidade de ${product.nome} adicionada ao carrinho. `), cartLink);
        } catch (error) {
            feedback.textContent = error.message || 'Não foi possível adicionar o item ao carrinho. Tente novamente.';
        } finally {
            addButton.disabled = false;
            addButton.setAttribute('aria-label', addButton.title);
            addButton.textContent = '+';
            if (hadFocus && document.activeElement === document.body) addButton.focus();
        }
    });
    info.append(addButton, feedback);

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
    let reloadRequested = false;
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
        if (isLoading) {
            if (reset) reloadRequested = true;
            return;
        }
        if (!reset && !hasMore) return;

        isLoading = true;
        reloadRequested = false;
        observer.unobserve(sentinel);
        const search = searchInput.value.trim();
        const category = categorySelect.value;
        const changed = () => reloadRequested || search !== searchInput.value.trim() || category !== categorySelect.value;

        if (reset) {
            currentPage = 1;
            hasMore = true;
            grid.replaceChildren();
        }

        sentinel.textContent = 'Carregando itens...';
        grid.appendChild(sentinel);

        try {
            const products = await getProdutos({
                search,
                category,
                availableOnly: true,
                page: currentPage,
                limit: PAGE_LIMIT
            });
            if (changed()) return;

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
            }
        } catch (error) {
            if (changed()) return;
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
            if (changed()) {
                clearTimeout(debounce);
                void loadCatalog(true);
            } else if (hasMore && sentinel.isConnected) {
                observer.observe(sentinel);
            }
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

    searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => loadCatalog(true), 250);
    });
    categorySelect.addEventListener('change', () => loadCatalog(true));

    try {
        const [{ profile, user }, categories] = await Promise.all([getSession(), getCategorias()]);
        signedIn = Boolean(user);
        if (!signedIn) {
            document.querySelector('.orders-section').hidden = true;
            const profileLink = headerAvatar.closest('a');
            profileLink.href = '/login';
            profileLink.textContent = 'Entrar';
        }
        headerAvatar.textContent = getInitials(profile?.nome || user?.user_metadata?.name || user?.email);

        categories.forEach((category) => {
            const option = document.createElement('option');
            option.value = category.nome_categoria;
            option.textContent = category.nome_categoria;
            categorySelect.appendChild(option);
        });

        await Promise.all([loadCatalog(true), signedIn ? loadRecentOrders(profile) : Promise.resolve()]);
    } catch (error) {
        console.error('Erro ao preparar catálogo:', error);
        grid.textContent = 'Não foi possível carregar o catálogo. Tente novamente.';
        return;
    }
});
