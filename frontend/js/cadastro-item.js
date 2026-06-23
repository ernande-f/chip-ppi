import { apiRequest } from './api.js';

document.addEventListener('DOMContentLoaded', () => {
    const formCadastro = document.getElementById('formCadastro');
    const btnSalvar = document.getElementById('btn-salvar');
    const categoriaInput = document.getElementById('categoria-input');
    const tagContainer = document.getElementById('tag-container');
    const fotoInput = document.getElementById('foto');

    let categorias = [];
    let base64Foto = '';

    // Lógica de Tags para Categorias
    categoriaInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = categoriaInput.value.trim();
            if (val && !categorias.includes(val)) {
                categorias.push(val);
                renderTags();
            }
            categoriaInput.value = '';
        }
    });

    function renderTags() {
        tagContainer.innerHTML = '';
        categorias.forEach((cat, index) => {
            const tag = document.createElement('span');
            tag.className = 'tag-item';
            tag.innerHTML = `${cat} <button type="button" data-index="${index}">&times;</button>`;
            tagContainer.appendChild(tag);
        });
        checkFormValidity();
    }

    tagContainer.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            const index = e.target.getAttribute('data-index');
            categorias.splice(index, 1);
            renderTags();
        }
    });

    // Lógica de Preview de Foto e conversão para Base64 (simulando upload)
    fotoInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                base64Foto = event.target.result;
                document.getElementById('label-foto').textContent = 'Foto selecionada';
                checkFormValidity();
            };
            reader.readAsDataURL(file);
        }
    });

    // Validação básica do formulário
    const inputs = formCadastro.querySelectorAll('input[required]');
    inputs.forEach(input => {
        input.addEventListener('input', checkFormValidity);
    });

    function checkFormValidity() {
        const allFilled = Array.from(inputs).every(input => input.value.trim() !== '');
        btnSalvar.disabled = !allFilled;
    }

    // Envio do formulário
    formCadastro.addEventListener('submit', async (e) => {
        e.preventDefault();

        const payload = {
            nome: document.getElementById('nome').value,
            estoque_total: document.getElementById('estoque').value,
            cor: document.getElementById('cor').value,
            foto_produto: base64Foto,
            categorias: categorias
        };

        try {
            btnSalvar.disabled = true;
            btnSalvar.textContent = 'Enviando...';

            await apiRequest('/api/produtos', {
                method: 'POST',
                body: payload
            });

            alert('Item cadastrado com sucesso!');
            window.location.href = 'index-tec.html';
        } catch (error) {
            console.error('Erro ao cadastrar item:', error);
            alert(error.message || 'Erro ao cadastrar item.');
            btnSalvar.disabled = false;
            btnSalvar.textContent = 'Concluir cadastro';
        }
    });
});
