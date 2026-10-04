import { formatDate, getPedidosGestao, transitionPedido } from './api.js';

const FALLBACK_IMAGE = '/assets/electronic_components_1_1774913851066.png';
const ACTIONS_BY_STATUS = {
    Pendente: [
        { action: 'approve', target: 'Aprovado', label: 'Aprovar pedido', className: 'btn-approve' },
        { action: 'deny', target: 'Negado', label: 'Negar pedido', className: 'btn-deny' }
    ],
    Aprovado: [
        { action: 'start_separation', target: 'Em separação', label: 'Iniciar separação', className: 'btn-approve' }
    ],
    'Em separação': [
        { action: 'mark_ready', target: 'Pronto para retirada', label: 'Marcar para retirada', className: 'btn-approve' }
    ],
    'Pronto para retirada': [
        { action: 'confirm_pickup', target: 'Retirado', label: 'Confirmar retirada', className: 'btn-approve' }
    ],
    Retirado: [
        { action: 'register_return', target: 'Devolvido', label: 'Registrar devolução', className: 'btn-approve' }
    ]
};

for (const status of ['Pendente', 'Aprovado', 'Em separação', 'Pronto para retirada']) {
    ACTIONS_BY_STATUS[status].push({ action: 'cancel', target: 'Cancelado', label: 'Cancelar pedido', className: 'btn-deny' });
}

let orders = [];
let busy = false;
let draggedOrder = null;
const STATUSES = ['Pendente', 'Aprovado', 'Em separação', 'Pronto para retirada', 'Retirado', 'Devolvido', 'Negado', 'Cancelado'];
let selectedOrder = null;
let previousFocus = null;

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

function getStatusBadge(status) {
    switch (status) {
        case 'Pendente':
            return { className: 'alert-badge status-pendente', symbol: '!' };
        case 'Aprovado':
            return { className: 'alert-badge status-aprovado', symbol: '✓' };
        case 'Em separação':
            return { className: 'alert-badge status-separando', symbol: '⟳' };
        case 'Pronto para retirada':
            return { className: 'alert-badge status-retirada', symbol: '✓' };
        case 'Retirado':
            return { className: 'alert-badge status-retirado', symbol: '⏱' };
        case 'Devolvido':
            return { className: 'alert-badge status-devolvido', symbol: '✓' };
        case 'Negado':
            return { className: 'alert-badge status-negado', symbol: '✕' };
        case 'Cancelado':
            return { className: 'alert-badge status-cancelado', symbol: '✕' };
        default:
            return { className: 'alert-badge status-pendente', symbol: '!' };
    }
}

function renderOrders() {
    const search = document.querySelector('.search-bar input').value.trim().toLowerCase();
    const visibleOrders = orders.filter((order) => {
        const searchable = `${order.id_pedido} ${order.usuario_nome} ${order.usuario_email}`.toLowerCase();
        return !search || searchable.includes(search);
    });
    const grid = document.getElementById('ordersGrid');
    grid.replaceChildren();

    const columns = new Map();
    STATUSES.forEach((status) => {
        const column = createElement('section', 'kanban-column');
        column.setAttribute('aria-label', status);
        column.appendChild(createElement('h2', 'kanban-heading', `${status} (${visibleOrders.filter(order => order.status === status).length})`));
        column.addEventListener('dragover', (event) => {
            if (!busy && (ACTIONS_BY_STATUS[draggedOrder?.status] || []).some(action => action.target === status)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                column.classList.add('drop-target');
            }
        });
        column.addEventListener('dragleave', () => column.classList.remove('drop-target'));
        column.addEventListener('drop', (event) => {
            event.preventDefault();
            column.classList.remove('drop-target');
            const action = (ACTIONS_BY_STATUS[draggedOrder?.status] || []).find(action => action.target === status);
            if (action && !busy) runAction(action.action, draggedOrder);
            draggedOrder = null;
        });
        grid.appendChild(column);
        columns.set(status, column);
    });

    visibleOrders.forEach((order) => {
        const card = createElement('article', 'order-card');
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `Pedido #${order.id_pedido}, ${order.status}. Abrir detalhes e ações`);
        card.draggable = !busy && Boolean(ACTIONS_BY_STATUS[order.status]?.length);
        card.addEventListener('dragstart', (event) => {
            draggedOrder = order;
            event.dataTransfer.setData('text/plain', String(order.id_pedido));
            event.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('dragend', () => {
            draggedOrder = null;
            document.querySelectorAll('.drop-target').forEach(column => column.classList.remove('drop-target'));
        });
        const top = createElement('div', 'order-top');
        const heading = document.createElement('div');
        heading.append(
            createElement('h3', 'order-title', `Pedido #${order.id_pedido}`),
            createElement('p', 'order-date', `${order.status} · ${formatDate(order.data_pedido)}`)
        );
        const badgeInfo = getStatusBadge(order.status);
        top.append(heading, createElement('div', badgeInfo.className, badgeInfo.symbol));

        const user = createElement('div', 'order-user');
        const userText = document.createElement('div');
        userText.append(
            createElement('p', 'user-name', order.usuario_nome),
            createElement('p', 'user-email', order.usuario_email || 'E-mail não informado')
        );
        user.append(createAvatar(order.usuario_nome), userText);
        card.append(top, document.createElement('hr'), user);
        if (order.retirada_prevista) card.appendChild(createElement('p', 'order-date', `Reserva: ${formatDate(order.retirada_prevista)} a ${formatDate(order.devolucao_prevista)}`));
        card.querySelector('hr').className = 'card-divider';
        card.addEventListener('click', () => openModal(order));
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openModal(order);
            }
        });
        columns.get(order.status)?.appendChild(card);
    });
}

function closeModal() {
    document.getElementById('orderModal').style.display = 'none';
    selectedOrder = null;
    previousFocus?.focus();
}

function openModal(order) {
    if (busy) return;
    previousFocus = document.activeElement;
    selectedOrder = order;
    document.getElementById('modalTitle').textContent = `Pedido #${order.id_pedido}`;
    document.getElementById('modalSubtitle').textContent = `${order.status} · solicitação em ${formatDate(order.data_pedido)}` + (order.retirada_prevista ? ` · Reserva: ${formatDate(order.retirada_prevista)} a ${formatDate(order.devolucao_prevista)}` : '');
    document.getElementById('modalUserName').textContent = order.usuario_nome;
    document.getElementById('modalUserEmail').textContent = order.usuario_email || 'E-mail não informado';
    document.getElementById('modalUserRole').textContent = getUserRole(order.usuario_email);

    const justificationBox = document.getElementById('modalJustificationBox');
    const justificationText = document.getElementById('modalJustificationText');
    if (justificationBox && justificationText) {
        if (order.justificativa) {
            justificationText.textContent = order.justificativa;
            justificationBox.style.display = 'block';
        } else {
            justificationText.textContent = '';
            justificationBox.style.display = 'none';
        }
    }

    const itemsContainer = document.getElementById('modalItems');
    itemsContainer.replaceChildren();
    order.itens.forEach((item) => {
        const row = createElement('div', 'item-row');
        const info = createElement('div', 'item-info');
        const image = document.createElement('img');
        image.src = item.foto_produto || FALLBACK_IMAGE;
        image.alt = `Foto de ${item.nome}`;
        image.className = 'item-thumb';
        image.referrerPolicy = 'no-referrer';
        image.onerror = () => {
            image.onerror = null;
            image.src = FALLBACK_IMAGE;
        };
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
    document.getElementById('modalClose').focus();
}

async function runAction(action, order = selectedOrder) {
    if (!order || busy) return;

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

    busy = true;
    document.getElementById('ordersGrid').setAttribute('aria-busy', 'true');
    try {
        await transitionPedido(order.id_pedido, action, reason);
        closeModal();
        await loadOrders();
    } catch (error) {
        alert(error.message || 'Não foi possível atualizar o pedido.');
    } finally {
        busy = false;
        document.getElementById('ordersGrid').setAttribute('aria-busy', 'false');
        renderOrders();
    }
}

async function loadOrders() {
    orders = await getPedidosGestao();
    renderOrders();
}

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('orderModal').addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeModal();
        if (event.key === 'Tab') {
            const buttons = [...document.querySelectorAll('#orderModal button:not(:disabled)')];
            const first = buttons[0], last = buttons.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
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
