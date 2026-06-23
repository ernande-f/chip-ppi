import { getProdutos } from './api.js';

document.addEventListener('DOMContentLoaded', async () => {
    const itemsGrid = document.getElementById('itemsGrid');

    async function loadProducts() {
        try {
            const produtos = await getProdutos();

            if (produtos.length === 0) {
                itemsGrid.innerHTML = '<p style="text-align: center; grid-column: 1/-1;">Nenhum item encontrado no estoque.</p>';
                return;
            }

            itemsGrid.innerHTML = produtos.map(p => {
                const img = p.foto_produto || '../assets/exemplo.png';
                const nome = p.nome || 'Sem nome';
                const qtd = p.estoque_total ?? 0;
                const cor = p.cor || 'Não informada';
                // Para simplificar, não estamos buscando a categoria no JOIN por enquanto na rota /produtos,
                // mas poderíamos melhorar a rota.

                return `
                    <div class="item-card">
                        <div class="item-visual">
                            <img src="${img}" alt="${nome}">
                        </div>
                        <div class="item-data">
                            <h3>${nome}</h3>
                            <p class="qty-label">Quantidade disponível: ${String(qtd).padStart(2, '0')}</p>
                            <p class="info-label">Cor: ${cor}</p>
                            <button class="btn-edit-item" onclick="openAlterarModal('${p.id_produto}')">Alterar</button>
                        </div>
                    </div>
                `;
            }).join('');

        } catch (error) {
            console.error('Erro ao carregar produtos:', error);
            itemsGrid.innerHTML = '<p style="text-align: center; grid-column: 1/-1; color: red;">Erro ao carregar produtos.</p>';
        }
    }

    loadProducts();
});

// Tornar global para os botões inline no HTML (se necessário, embora o ideal fosse não usar onclick inline)
window.openAlterarModal = function(id) {
    // Por enquanto apenas abre o modal estático, futuramente carregaria os dados do produto ID
    const mAlterar = document.getElementById('modalAlterar');
    if (mAlterar) {
        mAlterar.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
};
