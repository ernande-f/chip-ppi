import { formatDate, getPedidosGestao, transitionPedido } from './api.js';

const FALLBACK_IMAGE = '../assets/electronic_components_1_1774913851066.png';
const TAB_CONFIG = {
    solicitacoes: {
        statuses: ['Pendente'],
        note: 'Pedidos aguardando aprovação ou negação.'
    },
    separacao: {
        statuses: ['Aprovado', 'Em separação'],
        note: 'Pedidos aprovados que precisam ser separados.'
    },
    retirada: {
        statuses: ['Pronto para retirada'],
        note: 'Pedidos prontos para confirmação da retirada.'
    },
    devolucao: {
        statuses: ['Retirado'],
        note: 'Empréstimos aguardando devolução.'
    },
    historico: {
        statuses: ['Devolvido', 'Negado', 'Cancelado'],
        note: 'Pedidos encerrados, negados ou cancelados.'
    }
};
const ACTIONS_BY_STATUS = {
    Pendente: [
        { action: 'approve', label: 'Aprovar pedido', className: 'btn-approve' },
        { action: 'deny', label: 'Negar pedido', className: 'btn-deny' }
    ],
    Aprovado: [
        { action: 'start_separation', label: 'Iniciar separação', className: 'btn-approve' }
    ],
    'Em separação': [
        { action: 'mark_ready', label: 'Marcar para retirada', className: 'btn-approve' }
    ],
    'Pronto para retirada': [
        { action: 'confirm_pickup', label: 'Confirmar retirada', className: 'btn-approve' }
    ],
    Retirado: [
        { action: 'register_return', label: 'Registrar devolução', className: 'btn-approve' }
    ]
};

let orders = [];
let activeTab = 'solicitacoes';
let selectedOrder = null;

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function getUserRole(email) {
    const normalizedEmail = String(email || '').toLowerCase();

    if (normalizedEmail.endsWith('@aluno.iffar.edu.br')) return 'Estudante';
    if (normalizedEmail.endsWith('@iffarroupilha.edu.br')) return 'Professor';
    return 'Usuário institucional';
}

function createAvatar(name) {
    const avatar = createElement('div', 'user-avatar');
    avatar.textContent = String(name || 'U')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();
    return avatar;
}

function renderOrders() {
    const config = TAB_CONFIG[activeTab];
    const search = document.querySelector('.search-bar input').value.trim().toLowerCase();
    const visibleOrders = orders.filter((order) => {
        const matchesStatus = config.statuses.includes(order.status);
        const searchable = `${order.id_pedido} ${order.usuario_nome} ${order.usuario_email}`.toLowerCase();
        return matchesStatus && (!search || searchable.includes(search));
    });
    const grid = document.getElementById('ordersGrid');
    document.getElementById('tabNote').textContent = config.note;
    grid.replaceChildren();

    if (visibleOrders.length === 0) {
        grid.appendChild(createElement('p', 'empty-state', 'Nenhum pedido nesta etapa.'));
        return;
    }

    visibleOrders.forEach((order) => {
        const card = createElement('article', 'order-card');
        card.tabIndex = 0;
        const top = createElement('div', 'order-top');
        const heading = document.createElement('div');
        heading.append(
            createElement('h3', 'order-title', `Pedido #${order.id_pedido}`),
            createElement('p', 'order-date', `${order.status} · ${formatDate(order.data_pedido)}`)
        );
        top.append(heading, createElement('div', 'alert-badge', '!'));

        const user = createElement('div', 'order-user');
        const userText = document.createElement('div');
        userText.append(
            createElement('p', 'user-name', order.usuario_nome),
            createElement('p', 'user-email', order.usuario_email || 'E-mail não informado')
        );
        user.append(createAvatar(order.usuario_nome), userText);
        card.append(top, document.createElement('hr'), user);
        card.querySelector('hr').className = 'card-divider';
        card.addEventListener('click', () => openModal(order));
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') openModal(order);
        });
        grid.appendChild(card);
    });
}

function closeModal() {
    document.getElementById('orderModal').style.display = 'none';
    selectedOrder = null;
}

function openModal(order) {
    selectedOrder = order;
    document.getElementById('modalTitle').textContent = `Pedido #${order.id_pedido}`;
    document.getElementById('modalSubtitle').textContent = `${order.status} · solicitação em ${formatDate(order.data_pedido)}`;
    document.getElementById('modalUserName').textContent = order.usuario_nome;
    document.getElementById('modalUserEmail').textContent = order.usuario_email || 'E-mail não informado';
    document.getElementById('modalUserRole').textContent = getUserRole(order.usuario_email);

    const itemsContainer = document.getElementById('modalItems');
    itemsContainer.replaceChildren();
    order.itens.forEach((item) => {
        const row = createElement('div', 'item-row');
        const info = createElement('div', 'item-info');
        const image = document.createElement('img');
        image.src = item.foto_produto || FALLBACK_IMAGE;
        image.alt = `Foto de ${item.nome}`;
        image.className = 'item-thumb';
        const details = document.createElement('div');
        details.append(
            createElement('p', 'item-name', item.nome),
            createElement('p', 'item-meta', `Cor: ${item.cor || 'não informada'}`)
        );
        info.append(image, details);
        row.append(info, createElement('span', 'qty-pill', `${item.qnt_solicitada} un.`));
        itemsContainer.appendChild(row);
    });

    const actions = document.getElementById('modalActions');
    actions.replaceChildren();
    (ACTIONS_BY_STATUS[order.status] || []).forEach((config) => {
        const button = createElement('button', `modal-btn ${config.className}`, config.label);
        button.type = 'button';
        button.addEventListener('click', () => runAction(config.action));
        actions.appendChild(button);
    });
    document.getElementById('orderModal').style.display = 'flex';
}

async function runAction(action) {
    if (!selectedOrder) return;

    let reason = null;
    if (action === 'deny') {
        reason = prompt('Informe a justificativa obrigatória para negar o pedido:');
        if (reason === null) return;
        reason = reason.trim();
        if (!reason) {
            alert('Informe uma justificativa para negar o pedido.');
            return;
        }
    } else if (!confirm('Confirma esta mudança de status?')) {
        return;
    }

    try {
        await transitionPedido(selectedOrder.id_pedido, action, reason);
        closeModal();
        await loadOrders();
    } catch (error) {
        alert(error.message || 'Não foi possível atualizar o pedido.');
    }
}

async function loadOrders() {
    orders = await getPedidosGestao();
    renderOrders();
}

document.addEventListener('DOMContentLoaded', async () => {
    document.querySelectorAll('.tab-button').forEach((button) => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.tab-button').forEach((tab) => tab.classList.remove('active'));
            button.classList.add('active');
            activeTab = button.dataset.tab;
            renderOrders();
        });
    });

    document.querySelector('.search-bar input').addEventListener('input', renderOrders);
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('orderModal').addEventListener('click', (event) => {
        if (event.target.id === 'orderModal') closeModal();
    });

    try {
        await loadOrders();
    } catch (error) {
        console.error('Erro ao carregar gestão de pedidos:', error);
        document.getElementById('ordersGrid').appendChild(
            createElement('p', 'empty-state', error.message || 'Não foi possível carregar os pedidos.')
        );
    }
});
