import { createProduto, getCategorias } from './api.js';

function createTag(category, onRemove) {
    const tag = document.createElement('span');
    tag.className = 'tag-item';
    tag.textContent = category;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '×';
    button.setAttribute('aria-label', `Remover categoria ${category}`);
    button.addEventListener('click', onRemove);
    tag.appendChild(button);
    return tag;
}

document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('formCadastro');
    const saveButton = document.getElementById('btn-salvar');
    const categoryInput = document.getElementById('categoria-input');
    const tagContainer = document.getElementById('tag-container');
    const categoryList = document.getElementById('categorias-antigas');
    const photoInput = document.getElementById('foto');
    const photoLabel = document.getElementById('label-foto');
    let categories = [];
    let photo = '';

    function updateSaveState() {
        saveButton.disabled = !form.checkValidity() || categories.length === 0 || !photo;
    }

    function renderTags() {
        tagContainer.replaceChildren();
        categories.forEach((category, index) => {
            tagContainer.appendChild(createTag(category, () => {
                categories.splice(index, 1);
                renderTags();
            }));
        });
        updateSaveState();
    }

    function addCategory(value) {
        const category = value.trim();
        if (!category) return;

        if (!categories.some((item) => item.localeCompare(category, 'pt-BR', { sensitivity: 'accent' }) === 0)) {
            categories.push(category);
            renderTags();
        }
        categoryInput.value = '';
    }

    async function readImage(file) {
        if (!file) return '';
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
    form.querySelectorAll('input, textarea').forEach((input) => input.addEventListener('input', updateSaveState));

    photoInput.addEventListener('change', async () => {
        try {
            photo = await readImage(photoInput.files[0]);
            photoLabel.textContent = photo ? 'Foto selecionada' : 'Selecionar foto';
        } catch (error) {
            photo = '';
            photoInput.value = '';
            photoLabel.textContent = 'Selecionar foto';
            alert(error.message);
        }
        updateSaveState();
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        updateSaveState();
        if (saveButton.disabled) return;

        saveButton.disabled = true;
        saveButton.textContent = 'Cadastrando…';

        try {
            await createProduto({
                nome: document.getElementById('nome').value,
                descricao_produto: document.getElementById('descricao').value,
                estoque_total: document.getElementById('estoque').value,
                cor: document.getElementById('cor').value,
                foto_produto: photo,
                categorias: categories
            });
            window.location.href = '/';
        } catch (error) {
            alert(error.message || 'Não foi possível cadastrar o item.');
            saveButton.textContent = 'Concluir cadastro';
            updateSaveState();
        }
    });

    try {
        const existingCategories = await getCategorias();
        existingCategories.forEach((category) => {
            const option = document.createElement('option');
            option.value = category.nome_categoria;
            categoryList.appendChild(option);
        });
    } catch (error) {
        console.warn('Não foi possível carregar categorias existentes:', error);
    }
});
