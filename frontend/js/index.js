import { getInitials, getSession, getProdutos } from './api.js';

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const { profile, user } = await getSession();
        const headerAvatar = document.getElementById('headerAvatar');

        if (headerAvatar) {
            const displayName = profile?.nome || user?.user_metadata?.name || user?.email || '';
            headerAvatar.textContent = getInitials(displayName);
        }

        // Buscar produtos e renderizar
        const produtos = await getProdutos();
        const grid = document.querySelector('.grid-items');
        if (grid && Array.isArray(produtos)) {
            grid.innerHTML = produtos.map(p => {
                const img = p.foto_produto || '/assets/exemplo.png';
                const nome = p.nome || 'Sem nome';
                const desc = p.descricao_produto ? `<p class="desc">${p.descricao_produto}</p>` : '';
                const qtd = typeof p.estoque_total === 'number' ? p.estoque_total : '—';
                const cor = p.cor || 'Não informado';

                return `
                    <div class="card item-card">
                        <div class="item-image" style="background-image: url('${img}');"></div>
                        <div class="item-info">
                            <h3>${nome}</h3>
                            ${desc}
                            <p>Quantidade disponível: ${qtd}</p>
                            <p>Cor: ${cor}</p>
                            <button class="add-btn" data-id="${p.id_produto}">+</button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (error) {
        console.error('Erro ao validar sessão ou carregar produtos:', error);
        // redireciona para login se não estiver autenticado
        window.location.href = '/login';
    }
});