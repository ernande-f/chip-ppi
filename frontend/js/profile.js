import {
    formatDate,
    getInitials,
    getProfile,
    getStatusClass,
    isUserTechnical,
    logout,
    updateNavbarForRole
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
        container.innerHTML = '<p class="empty-state">Você ainda não possui pedidos registrados.</p>';
        return;
    }

    container.replaceChildren(...orders.map((order) => {
        const card = document.createElement('article');
        card.className = 'order-card';
        card.innerHTML = `
            <div class="order-id">
                <h3></h3>
                <span></span>
            </div>

            <div class="order-meta">
                <span></span>
                <span></span>
            </div>

            <p class="order-text"></p>
        `;
        card.querySelector('h3').textContent = `Pedido #${order.id_pedido}`;
        const status = card.querySelector('.order-id span');
        status.className = getStatusClass(order.status);
        status.textContent = order.status;
        const [orderDate, returnDate] = card.querySelectorAll('.order-meta span');
        orderDate.textContent = `Data do pedido: ${formatDate(order.data_pedido)}`;
        returnDate.textContent = `Devolucao: ${formatDate(order.data_devolucao)}`;
        card.querySelector('.order-text').textContent = order.motivo_recusa || 'Acompanhe seu perfil para consultar status, retirada e devolução dos itens solicitados.';
        return card;
    }));
}

async function loadProfile() {
    const { profile } = await getProfile();
    const initials = getInitials(profile.nome);
    const isTechnical = isUserTechnical(profile);

    const roleLabel = isTechnical
        ? (profile.nivel_acesso === 2 || String(profile.nivel_acesso).toLowerCase().includes('adm') ? 'Administrador' : (profile.nivel_acesso_label || 'Técnico'))
        : (profile.nivel_acesso_label || 'Usuário');

    document.getElementById('profileName').textContent = profile.nome;
    document.getElementById('profileEmail').textContent = profile.email;
    document.getElementById('profileRole').textContent = roleLabel;
    document.getElementById('profileAvatar').textContent = initials;
    const headerAvatar = document.getElementById('headerAvatar');
    if (headerAvatar) headerAvatar.textContent = initials;

    updateNavbarForRole(profile);

    const historyBanner = document.querySelector('.history-banner');
    const historyContainer = document.querySelector('.content-container');

    if (isTechnical) {
        if (historyBanner) historyBanner.style.display = 'none';
        if (historyContainer) historyContainer.style.display = 'none';
    } else {
        if (historyBanner) historyBanner.style.display = '';
        if (historyContainer) historyContainer.style.display = '';
        renderOrders(profile.recentOrders);
    }
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
            alert(error.message || 'Nao foi possivel encerrar a sessão.');
        }
    });

    try {
        await loadProfile();
    } catch (error) {
        console.error('Erro ao carregar perfil:', error);
        redirectToLogin();
    }
});
