import {
    formatDate,
    getInitials,
    getProfile,
    getStatusClass,
    logout
} from './api.js';

function redirectToLogin() {
    window.location.href = '/login';
}

function openModal(modal) {
    modal.classList.add('active');
}

function closeModal(modal) {
    modal.classList.remove('active');
}

function renderOrders(orders) {
    const container = document.getElementById('ordersPreview');

    if (!orders?.length) {
        container.innerHTML = '<p class="empty-state">Voce ainda nao possui pedidos registrados.</p>';
        return;
    }

    container.innerHTML = orders.map((order) => `
        <article class="order-card">
            <div class="order-id">
                <h3>Pedido #${order.id_pedido}</h3>
                <span class="${getStatusClass(order.status)}">${order.status}</span>
            </div>

            <div class="order-meta">
                <span>Data do pedido: ${formatDate(order.data_pedido)}</span>
                <span>Devolucao: ${formatDate(order.data_devolucao)}</span>
            </div>

            <p class="order-text">
                ${order.motivo_recusa || 'Acompanhe seu perfil para consultar status, retirada e devolucao dos itens solicitados.'}
            </p>
        </article>
    `).join('');
}

async function loadProfile() {
    const { profile } = await getProfile();
    const initials = getInitials(profile.nome);

    document.getElementById('profileName').textContent = profile.nome;
    document.getElementById('profileEmail').textContent = profile.email;
    document.getElementById('profileRole').textContent = profile.nivel_acesso_label || 'Usuario';
    document.getElementById('profileAvatar').textContent = initials;
    document.getElementById('headerAvatar').textContent = initials;

    renderOrders(profile.recentOrders);
}

document.addEventListener('DOMContentLoaded', async () => {
    const logoutModal = document.getElementById('logoutModal');
    const logoutTrigger = document.getElementById('logoutTrigger');
    const confirmLogout = document.getElementById('confirmLogout');
    const cancelLogout = document.getElementById('cancelLogout');

    logoutTrigger.addEventListener('click', () => openModal(logoutModal));
    cancelLogout.addEventListener('click', () => closeModal(logoutModal));
    logoutModal.addEventListener('click', (event) => {
        if (event.target === logoutModal) {
            closeModal(logoutModal);
        }
    });

    confirmLogout.addEventListener('click', async () => {
        try {
            await logout();
            redirectToLogin();
        } catch (error) {
            console.error('Erro ao fazer logout:', error);
            alert(error.message || 'Nao foi possivel encerrar a sessao.');
        }
    });

    try {
        await loadProfile();
    } catch (error) {
        console.error('Erro ao carregar perfil:', error);
        redirectToLogin();
    }
});
