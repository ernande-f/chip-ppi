import {
    cancelPedido,
    checkoutCarrinho,
    formatDate,
    getCarrinho,
    getPedidos,
    removeItemCarrinho,
    updateItemCarrinho
} from './api.js';

const FALLBACK_IMAGE = '../assets/electronic_components_1_1774913851066.png';
const TERMINAL_STATUSES = new Set(['Devolvido', 'Negado', 'Cancelado']);
let orders = [];
let selectedOrder = null;

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function renderEmpty(container, message) {
    container.replaceChildren(createElement('p', 'empty-state', message));
}

async function loadCart() {
    const container = document.getElementById('cartItems');
    const checkoutButton = document.getElementById('checkoutButton');
    const items = await getCarrinho();
    container.replaceChildren();
    checkoutButton.disabled = items.length === 0;

    if (items.length === 0) {
        renderEmpty(container, 'Seu carrinho está vazio. Adicione itens pelo catálogo.');
        return;
    }

    items.forEach((item) => {
        const row = createElement('div', 'table-row');
        const productInfo = createElement('div', 'product-info');
        const image = document.createElement('img');
        image.className = 'product-thumb';
        image.src = item.foto_produto || FALLBACK_IMAGE;
        image.alt = `Foto de ${item.nome}`;

        const details = createElement('div', 'product-details');
        details.append(
            createElement('strong', null, item.nome),
            createElement('span', null, `Cor: ${item.cor || 'não informada'}`),
            createElement('span', null, `Disponível: ${item.estoque_total} un.`)
        );
        productInfo.append(image, details);

        const actions = createElement('div', 'product-actions');
        const quantity = createElement('div', 'quantity-control');
        const minus = createElement('button', null, '-');
        const value = createElement('span', 'qty-value', String(item.quantidade));
        const plus = createElement('button', null, '+');
        minus.type = 'button';
        plus.type = 'button';
        minus.disabled = item.quantidade <= 1;
        plus.disabled = item.quantidade >= item.estoque_total;

        minus.addEventListener('click', () => changeQuantity(item, item.quantidade - 1));
        plus.addEventListener('click', () => changeQuantity(item, item.quantidade + 1));
        quantity.append(minus, value, plus);

        const remove = createElement('button', 'delete-btn', 'Remover');
        remove.type = 'button';
        remove.addEventListener('click', async () => {
            try {
                await removeItemCarrinho(item.id_produto);
                await loadCart();
            } catch (error) {
                alert(error.message || 'Não foi possível remover o item.');
            }
        });

        actions.append(quantity, remove);
        row.append(productInfo, actions);
        container.appendChild(row);
    });
}

async function changeQuantity(item, quantity) {
    try {
        await updateItemCarrinho(item.id_produto, quantity);
        await loadCart();
    } catch (error) {
        alert(error.message || 'Não foi possível atualizar a quantidade.');
    }
}

function createOrderCard(order, compact = false) {
    const card = createElement('button', compact ? 'card ongoing-card' : 'card history-card');
    card.type = 'button';

    if (compact) {
        const info = createElement('div', 'ongoing-info');
        info.append(
            createElement('strong', null, `Pedido #${order.id_pedido}`),
            createElement('span', 'devolution-date', order.data_prevista_devolucao
                ? `Devolução prevista: ${formatDate(order.data_prevista_devolucao)}`
                : `Status: ${order.status}`)
        );
        card.append(info, createElement('div', 'status-icon yellow', '!'));
    } else {
        const header = createElement('div', 'history-card-header');
        header.append(
            createElement('strong', null, `Pedido #${order.id_pedido}`),
            createElement('span', 'history-date', formatDate(order.data_pedido))
        );
        card.append(
            header,
            createElement('p', 'history-description', `${order.status} · ${order.itens.length} item(ns)`)
        );
    }

    card.addEventListener('click', () => openOrderModal(order));
    return card;
}

function renderOrders(filter = 'all') {
    const activeContainer = document.getElementById('activeOrders');
    const historyContainer = document.getElementById('orderHistory');
    const activeOrders = orders.filter((order) => !TERMINAL_STATUSES.has(order.status));
    const history = orders.filter((order) => TERMINAL_STATUSES.has(order.status));
    const filteredHistory = filter === 'all'
        ? history
        : history.filter((order) => order.status === filter);

    activeContainer.replaceChildren();
    historyContainer.replaceChildren();

    if (activeOrders.length === 0) {
        renderEmpty(activeContainer, 'Você não possui pedidos em andamento.');
    } else {
        activeOrders.forEach((order) => activeContainer.appendChild(createOrderCard(order, true)));
    }

    if (filteredHistory.length === 0) {
        renderEmpty(historyContainer, 'Nenhum pedido encontrado neste histórico.');
    } else {
        filteredHistory.forEach((order) => historyContainer.appendChild(createOrderCard(order)));
    }
}

async function loadOrders() {
    orders = await getPedidos();
    const activeFilter = document.querySelector('#historyTabs .tab.active')?.dataset.filter || 'all';
    renderOrders(activeFilter);
}

function closeOrderModal() {
    document.getElementById('modalPedido').style.display = 'none';
    selectedOrder = null;
}

function openOrderModal(order) {
    selectedOrder = order;
    document.getElementById('modalNumPedido').textContent = `Pedido #${order.id_pedido}`;
    document.getElementById('modalStatus').textContent = order.status;
    document.getElementById('modalData').textContent = formatDate(order.data_pedido);
    document.getElementById('modalReason').textContent = order.motivo_recusa
        ? `Justificativa: ${order.motivo_recusa}`
        : '';

    const itemsContainer = document.getElementById('modalOrderItems');
    itemsContainer.replaceChildren();
    order.itens.forEach((item) => {
        const row = createElement('div', 'modal-item-row');
        const info = createElement('div', 'modal-prod-info');
        const image = document.createElement('img');
        image.src = item.foto_produto || FALLBACK_IMAGE;
        image.alt = `Foto de ${item.nome}`;
        const details = createElement('div', 'modal-prod-details');
        details.append(
            createElement('strong', null, item.nome),
            createElement('span', null, `Cor: ${item.cor || 'não informada'}`)
        );
        info.append(image, details);
        row.append(info, createElement('div', 'modal-qty-badge', `${item.qnt_solicitada} un.`));
        itemsContainer.appendChild(row);
    });

    const actions = document.getElementById('studentOrderActions');
    actions.replaceChildren();
    if (order.status === 'Pendente') {
        const cancel = createElement('button', 'action-btn', 'Cancelar solicitação');
        cancel.type = 'button';
        cancel.addEventListener('click', cancelSelectedOrder);
        actions.appendChild(cancel);
    }

    document.getElementById('modalPedido').style.display = 'flex';
}

async function cancelSelectedOrder() {
    if (!selectedOrder || !confirm('Deseja cancelar esta solicitação?')) return;

    try {
        await cancelPedido(selectedOrder.id_pedido);
        closeOrderModal();
        await loadOrders();
    } catch (error) {
        alert(error.message || 'Não foi possível cancelar o pedido.');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const checkoutButton = document.getElementById('checkoutButton');
    const modal = document.getElementById('modalPedido');

    checkoutButton.addEventListener('click', async () => {
        checkoutButton.disabled = true;

        try {
            await checkoutCarrinho(
                document.getElementById('loanDuration').value,
                document.getElementById('acceptTerms').checked
            );
            document.getElementById('acceptTerms').checked = false;
            await Promise.all([loadCart(), loadOrders()]);
            alert('Pedido enviado para aprovação.');
        } catch (error) {
            alert(error.message || 'Não foi possível concluir o pedido.');
            checkoutButton.disabled = false;
        }
    });

    document.getElementById('closeOrderModal').addEventListener('click', closeOrderModal);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeOrderModal();
    });

    document.getElementById('historyTabs').addEventListener('click', (event) => {
        const tab = event.target.closest('.tab');
        if (!tab) return;
        document.querySelectorAll('#historyTabs .tab').forEach((item) => item.classList.remove('active'));
        tab.classList.add('active');
        renderOrders(tab.dataset.filter);
    });

    try {
        await Promise.all([loadCart(), loadOrders()]);
    } catch (error) {
        console.error('Erro ao carregar pedidos:', error);
        alert(error.message || 'Não foi possível carregar seus pedidos.');
    }
});
