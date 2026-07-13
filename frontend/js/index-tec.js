import {
    deleteProduto,
    getCategorias,
    getProduto,
    getProdutos,
    updateProduto
} from './api.js';

const FALLBACK_IMAGE = '../assets/electronic_components_1_1774913851066.png';

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function normalizeCategories(categories) {
    return Array.isArray(categories) ? categories : [];
}

function createItemCard(product, onEdit) {
    const card = createElement('article', 'item-card');
    const visual = createElement('div', 'item-visual');
    const image = document.createElement('img');
    image.src = product.foto_produto || FALLBACK_IMAGE;
    image.alt = product.nome;
    visual.appendChild(image);

    const details = createElement('div', 'item-data');
    details.append(
        createElement('h3', null, product.nome),
        createElement('p', 'qty-label', `Estoque: ${product.estoque_total} un.`),
        createElement('p', 'info-label', `${normalizeCategories(product.categorias).join(', ') || 'Sem categoria'} · ${product.cor || 'Sem cor'}`),
        createElement('span', `status-badge status-${String(product.status_produto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`, product.status_produto)
    );

    const editButton = createElement('button', 'btn-edit-item', 'Alterar');
    editButton.type = 'button';
    editButton.addEventListener('click', () => onEdit(product.id_produto));
    details.appendChild(editButton);
    card.append(visual, details);
    return card;
}

function setImagePreview(source) {
    document.getElementById('itemImagePreview').src = source || FALLBACK_IMAGE;
}

document.addEventListener('DOMContentLoaded', async () => {
    const grid = document.getElementById('itemsGrid');
    const modal = document.getElementById('modalAlterar');
    const form = document.getElementById('editProductForm');
    const searchInput = document.getElementById('managementSearch');
    const statusFilter = document.getElementById('managementStatus');
    const categoryInput = document.getElementById('editCategoryInput');
    const categoryTags = document.getElementById('editCategoryTags');
    const categoryList = document.getElementById('editCategoryList');
    const imageInput = document.getElementById('fileInput');
    const archiveInput = document.getElementById('archiveItem');
    let categories = [];
    let products = [];
    let activeCategories = [];
    let selectedPhoto = null;
    let debounce;

    function closeModal() {
        modal.style.display = 'none';
        document.body.style.overflow = '';
        form.reset();
        activeCategories = [];
        selectedPhoto = null;
        categoryTags.replaceChildren();
    }

    function renderCategoryTags() {
        categoryTags.replaceChildren();
        activeCategories.forEach((category, index) => {
            const tag = createElement('span', 'tag-item', category);
            const remove = createElement('button', null, '×');
            remove.type = 'button';
            remove.setAttribute('aria-label', `Remover categoria ${category}`);
            remove.addEventListener('click', () => {
                activeCategories.splice(index, 1);
                renderCategoryTags();
            });
            tag.appendChild(remove);
            categoryTags.appendChild(tag);
        });
    }

    function addCategory(value) {
        const category = value.trim();
        if (!category) return;
        if (!activeCategories.some((item) => item.localeCompare(category, 'pt-BR', { sensitivity: 'accent' }) === 0)) {
            activeCategories.push(category);
            renderCategoryTags();
        }
        categoryInput.value = '';
    }

    function renderProducts() {
        const status = statusFilter.value;
        const visible = status ? products.filter((product) => product.status_produto === status) : products;
        grid.replaceChildren();

        if (visible.length === 0) {
            grid.appendChild(createElement('p', 'catalog-empty', 'Nenhum item encontrado.'));
            return;
        }

        visible.forEach((product) => grid.appendChild(createItemCard(product, openEditModal)));
    }

    async function loadProducts() {
        try {
            products = await getProdutos({ search: searchInput.value.trim(), includeArchived: true });
            renderProducts();
        } catch (error) {
            console.error('Erro ao carregar itens:', error);
            grid.replaceChildren(createElement('p', 'catalog-empty catalog-error', error.message || 'Não foi possível carregar os itens.'));
        }
    }

    async function openEditModal(id) {
        try {
            const product = await getProduto(id);
            document.getElementById('editProductId').value = product.id_produto;
            document.getElementById('editName').value = product.nome || '';
            document.getElementById('editDescription').value = product.descricao_produto || '';
            document.getElementById('editStock').value = product.estoque_total ?? 0;
            document.getElementById('editColor').value = product.cor || '';
            archiveInput.checked = product.status_produto === 'Arquivado';
            activeCategories = normalizeCategories(product.categorias);
            selectedPhoto = null;
            setImagePreview(product.foto_produto);
            renderCategoryTags();
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        } catch (error) {
            alert(error.message || 'Não foi possível abrir o item.');
        }
    }

    async function readImage(file) {
        if (!file) return null;
        if (!file.type.startsWith('image/')) throw new Error('Selecione um arquivo de imagem.');
        if (file.size > 2 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 2 MB.');

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
            reader.readAsDataURL(file);
        });
    }

    categoryInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addCategory(categoryInput.value);
        }
    });
    categoryInput.addEventListener('change', () => addCategory(categoryInput.value));

    imageInput.addEventListener('change', async () => {
        try {
            selectedPhoto = await readImage(imageInput.files[0]);
            setImagePreview(selectedPhoto);
        } catch (error) {
            imageInput.value = '';
            alert(error.message);
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (activeCategories.length === 0) {
            alert('Informe ao menos uma categoria.');
            return;
        }

        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        submit.textContent = 'Salvando…';

        try {
            await updateProduto(document.getElementById('editProductId').value, {
                nome: document.getElementById('editName').value,
                descricao_produto: document.getElementById('editDescription').value,
                estoque_total: document.getElementById('editStock').value,
                cor: document.getElementById('editColor').value,
                categorias: activeCategories,
                archived: archiveInput.checked,
                ...(selectedPhoto ? { foto_produto: selectedPhoto } : {})
            });
            closeModal();
            await loadProducts();
        } catch (error) {
            alert(error.message || 'Não foi possível atualizar o item.');
        } finally {
            submit.disabled = false;
            submit.textContent = 'Salvar alterações';
        }
    });

    document.getElementById('deleteItemButton').addEventListener('click', async () => {
        const id = document.getElementById('editProductId').value;
        if (!window.confirm('Remover este item permanentemente do catálogo?')) return;

        try {
            await deleteProduto(id);
            closeModal();
            await loadProducts();
        } catch (error) {
            alert(error.message || 'Não foi possível remover o item.');
        }
    });

    document.getElementById('closeEditModal').addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });
    searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(loadProducts, 250);
    });
    statusFilter.addEventListener('change', renderProducts);

    try {
        categories = await getCategorias();
        categories.forEach((category) => {
            const option = document.createElement('option');
            option.value = category.nome_categoria;
            categoryList.appendChild(option);
        });
        await loadProducts();
    } catch (error) {
        grid.replaceChildren(createElement('p', 'catalog-empty catalog-error', error.message || 'Não foi possível abrir o catálogo.'));
    }
});
