import { getCategorias, getInitials, getProdutos, getSession } from './api.js';

const FALLBACK_IMAGE = '../assets/electronic_components_1_1774913851066.png';

function createProductCard(product) {
    const card = document.createElement('article');
    card.className = 'card item-card';

    const image = document.createElement('div');
    image.className = 'item-image';
    const imageElement = document.createElement('img');
    imageElement.src = product.foto_produto || FALLBACK_IMAGE;
    imageElement.alt = `Foto de ${product.nome}`;
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
    metadata.textContent = `${categories || 'Sem categoria'} · ${product.cor || 'Cor não informada'}`;
    info.appendChild(metadata);

    const addButton = document.createElement('button');
    addButton.className = 'add-btn';
    addButton.type = 'button';
    addButton.disabled = true;
    addButton.title = 'O carrinho será disponibilizado no próximo módulo.';
    addButton.textContent = '+';
    info.appendChild(addButton);

    card.append(image, info);
    return card;
}

function renderProducts(grid, products) {
    grid.replaceChildren();

    if (products.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'catalog-empty';
        empty.textContent = 'Nenhum item disponível corresponde à sua pesquisa.';
        grid.appendChild(empty);
        return;
    }

    products.forEach((product) => grid.appendChild(createProductCard(product)));
}

document.addEventListener('DOMContentLoaded', async () => {
    const searchInput = document.getElementById('catalogSearch');
    const categorySelect = document.getElementById('catalogCategory');
    const grid = document.getElementById('catalogGrid');
    const headerAvatar = document.getElementById('headerAvatar');
    let debounce;

    async function loadCatalog() {
        try {
            const products = await getProdutos({
                search: searchInput.value.trim(),
                category: categorySelect.value,
                availableOnly: true
            });
            renderProducts(grid, products);
        } catch (error) {
            console.error('Erro ao carregar catálogo:', error);
            grid.replaceChildren();
            const message = document.createElement('p');
            message.className = 'catalog-empty catalog-error';
            message.textContent = error.message || 'Não foi possível carregar o catálogo.';
            grid.appendChild(message);
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

        await loadCatalog();
    } catch (error) {
        console.error('Erro ao preparar catálogo:', error);
        window.location.href = '/login';
        return;
    }

    searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(loadCatalog, 250);
    });
    categorySelect.addEventListener('change', loadCatalog);
});
