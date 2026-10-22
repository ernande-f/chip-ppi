import { formatDate, getPedidosGestao, transitionPedido, decidirRenovacao } from './api.js';

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

let orders = [];
let busy = false;
let draggedOrder = null;
const STATUSES = ['Pendente', 'Aprovado', 'Em separação', 'Pronto para retirada', 'Retirado'];
const TERMINAL_STATUSES = new Set(['Devolvido', 'Negado', 'Cancelado', 'Expirado']);
const HISTORY_PAGE_SIZE = 12;
let historyLimit = HISTORY_PAGE_SIZE;
let selectedOrder = null;
let previousFocus = null;

export function selectOrders(orders, search, historyPeriod, historyStatus, today = new Date()) {
    const query = search.trim().toLowerCase();
    const matching = orders.filter((order) =>
        `${order.id_pedido} ${order.usuario_nome} ${order.usuario_email}`.toLowerCase().includes(query)
    );
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (historyPeriod !== 'all') start.setDate(start.getDate() - (Number(historyPeriod) - 1));
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    const historyOrders = matching.filter((order) => {
        if (!TERMINAL_STATUSES.has(order.status)) return false;
        if (historyStatus !== 'all' && order.status !== historyStatus) return false;
        if (historyPeriod === 'all') return true;
        const requested = new Date(`${String(order.data_pedido).slice(0, 10)}T00:00:00`);
        return requested >= start && requested <= end;
    });
    return {
        activeOrders: matching.filter((order) => !TERMINAL_STATUSES.has(order.status)),
        historyOrders,
        historyTotal: orders.filter((order) => TERMINAL_STATUSES.has(order.status)).length
    };
}

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
        case 'Expirado':
            return { className: 'alert-badge status-cancelado', symbol: '✕' };
        default:
            return { className: 'alert-badge status-pendente', symbol: '!' };
    }
}

function renderOrders() {
    const search = document.querySelector('.search-bar input').value.trim().toLowerCase();
    const { activeOrders, historyOrders, historyTotal } = selectOrders(
        orders, search, document.getElementById('historyPeriod').value, document.getElementById('historyStatus').value
    );
    document.getElementById('activeOrderCount').textContent = activeOrders.length;
    document.getElementById('historyOrderCount').textContent = `${historyOrders.length} de ${historyTotal}`;
    document.getElementById('ordersSummary').textContent = `${activeOrders.length} pedido(s) em andamento${search ? ' nesta busca' : ''}. Os filtros de período e situação afetam somente o histórico.`;
    const grid = document.getElementById('ordersGrid');
    grid.replaceChildren();

    STATUSES.forEach((status) => {
        const statusOrders = activeOrders.filter(order => order.status === status);
        const column = createElement('section', 'kanban-column');
        column.setAttribute('aria-label', status);
        const heading = createElement('h3', 'kanban-heading', status);
        heading.appendChild(createElement('span', 'order-count', statusOrders.length));
        column.appendChild(heading);
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
        statusOrders.forEach(order => column.appendChild(createOrderCard(order)));
        if (!statusOrders.length) column.appendChild(createElement('p', 'column-empty', search ? 'Nenhum resultado nesta etapa.' : 'Nenhum pedido nesta etapa.'));
        grid.appendChild(column);
    });

    const historyGrid = document.getElementById('historyGrid');
    historyGrid.replaceChildren(...historyOrders.slice(0, historyLimit).map(createOrderCard));
    if (!historyOrders.length) historyGrid.appendChild(createElement('p', 'empty-state', 'Nenhum pedido encontrado no histórico. Ajuste a busca ou os filtros para consultar outros pedidos.'));
    document.getElementById('historySummary').textContent = `Mostrando ${Math.min(historyLimit, historyOrders.length)} de ${historyOrders.length} pedido(s) neste filtro. Total no histórico: ${historyTotal}.`;
    const more = document.getElementById('historyMore');
    more.hidden = historyOrders.length <= historyLimit;
    more.textContent = `Ver mais ${Math.max(0, Math.min(HISTORY_PAGE_SIZE, historyOrders.length - historyLimit))} pedidos`;
}

function createOrderCard(order) {
    const card = createElement('article', 'order-card');
    card.dataset.orderId = order.id_pedido;
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
    if (order.renovacoes?.some(renewal => renewal.status === 'Pendente')) {
        card.appendChild(createElement('p', 'renewal-badge', 'Renovação aguardando análise'));
        card.setAttribute('aria-label', `Pedido #${order.id_pedido}, ${order.status}, renovação aguardando análise. Abrir detalhes e ações`);
    }
    if (order.data_devolucao) card.appendChild(createElement('p', 'order-date', `Devolvido em: ${formatDate(order.data_devolucao)}`));
    else if (order.data_retirada) card.appendChild(createElement('p', 'order-date', `Devolução até: ${formatDate(order.data_prevista_devolucao)}`));
    else if (order.data_limite_retirada) card.appendChild(createElement('p', 'order-date', `Retirar até: ${formatDate(order.data_limite_retirada)}`));
    card.querySelector('hr').className = 'card-divider';
    card.addEventListener('click', () => openModal(order));
    card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openModal(order);
        }
    });
    return card;
}

function closeModal() {
    document.getElementById('orderModal').style.display = 'none';
    document.body.style.overflow = '';
    document.querySelector('.page-wrap').inert = false;
    document.getElementById('returnSection').hidden = true;
    selectedOrder = null;
    if (previousFocus?.isConnected) previousFocus.focus();
    else document.getElementById('ordersGrid').focus();
}

function openModal(order) {
    if (busy) return;
    previousFocus = document.activeElement;
    selectedOrder = order;
    document.getElementById('returnSection').hidden = true;
    document.getElementById('modalTitle').textContent = `Pedido #${order.id_pedido}`;
    document.getElementById('modalSubtitle').textContent = `${order.status} · solicitação em ${formatDate(order.data_pedido)}` + (order.data_devolucao
        ? ` · Devolvido em: ${formatDate(order.data_devolucao)}`
        : order.data_retirada ? ` · Devolução até: ${formatDate(order.data_prevista_devolucao)}`
        : order.data_limite_retirada ? ` · Retirar até: ${formatDate(order.data_limite_retirada)}` : '');
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
    const refusalReason = document.getElementById('modalRefusalReason');
    refusalReason.textContent = order.motivo_recusa ? `Justificativa da recusa: ${order.motivo_recusa}` : '';
    refusalReason.hidden = !order.motivo_recusa;

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
        if (order.data_retirada) details.appendChild(createElement('p', 'item-meta',
            `Recebidos: ${item.qnt_devolvida || 0} · Danificados: ${item.qnt_danificada || 0} · Faltam: ${item.qnt_solicitada - (item.qnt_devolvida || 0)}`
        ));
        info.append(image, details);
        row.append(info, createElement('span', 'qty-pill', `${item.qnt_solicitada} un.`));
        itemsContainer.appendChild(row);
    });

    const actions = document.getElementById('modalActions');
    actions.replaceChildren();
    (ACTIONS_BY_STATUS[order.status] || []).forEach((config) => {
        const button = createElement('button', `modal-btn ${config.className}`, config.label);
        button.type = 'button';
        button.addEventListener('click', () => config.action === 'register_return' ? openReturnForm(order) : runAction(config.action));
        actions.appendChild(button);
    });
    actions.hidden = false;
    const log = document.getElementById('returnLogEntries');
    log.replaceChildren();
    (order.devolucoes || []).forEach((entry) => {
        const occurrence = createElement('article', 'return-occurrence');
        occurrence.appendChild(createElement('h4', null, `Recebido em ${formatDate(entry.data)}`));
        const items = createElement('ul');
        entry.itens.forEach(item => {
            const product = order.itens.find(product => String(product.id_produto) === String(item.id_produto));
            items.appendChild(createElement('li', null, `${product?.nome || `Item #${item.id_produto}`}: ${item.quantidade} recebida(s), ${item.danificada} danificada(s).`));
        });
        occurrence.appendChild(items);
        if (entry.observacao) occurrence.appendChild(createElement('p', 'return-observation', entry.observacao));
        log.appendChild(occurrence);
    });
    document.getElementById('returnLog').hidden = !order.devolucoes?.length;
    renderRenewals(order);
    document.body.style.overflow = 'hidden';
    document.querySelector('.page-wrap').inert = true;
    document.getElementById('orderModal').style.display = 'flex';
    document.getElementById('modalClose').focus();
}

function renderRenewals(order) {
    const container = document.getElementById('managedRenewals');
    container.replaceChildren();
    if (!order.renovacoes?.length) return;
    container.appendChild(createElement('h3', null, 'Renovações'));
    order.renovacoes.forEach(renewal => {
        const record = createElement('article', 'renewal-record');
        record.append(createElement('strong', null, `${renewal.status} · Prazo solicitado: ${formatDate(renewal.data_estendida)}`),
            createElement('p', null, `Solicitada em ${formatDate(renewal.data_solicitacao)} · ${renewal.justificativa_estendimento}`));
        if (renewal.motivo_recusa) record.appendChild(createElement('p', null, `Motivo: ${renewal.motivo_recusa}`));
        if (renewal.status === 'Pendente' && order.status === 'Retirado') {
            const form = document.createElement('form');
            const label = createElement('label', null, 'Motivo da negativa (obrigatório ao negar)');
            const reason = document.createElement('textarea');
            reason.maxLength = 1000;
            reason.rows = 2;
            reason.required = true;
            label.appendChild(reason);
            const actions = createElement('div', 'modal-actions');
            const approve = createElement('button', 'modal-btn btn-approve', 'Aprovar renovação');
            approve.type = 'button';
            const deny = createElement('button', 'modal-btn btn-deny', 'Negar renovação');
            deny.type = 'submit';
            approve.addEventListener('click', () => runRenewalDecision(order, renewal, true));
            form.addEventListener('submit', event => {
                event.preventDefault();
                runRenewalDecision(order, renewal, false, reason.value);
            });
            actions.append(approve, deny);
            form.append(label, actions);
            record.appendChild(form);
        }
        container.appendChild(record);
    });
}

async function runRenewalDecision(order, renewal, approved, reason) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('#managedRenewals button').forEach(button => { button.disabled = true; });
    const feedback = document.getElementById('renewalDecisionFeedback');
    feedback.textContent = '';
    try {
        const updated = await decidirRenovacao(order.id_pedido, renewal.id_renovacao, approved, reason);
        await loadOrders();
        busy = false;
        openModal(updated);
        feedback.textContent = approved ? 'Renovação aprovada. O novo prazo já está em vigor.' : 'Renovação negada. O prazo anterior foi mantido.';
    } catch (error) {
        feedback.textContent = error.message || 'Não foi possível analisar a renovação.';
    } finally {
        busy = false;
        document.querySelectorAll('#managedRenewals button').forEach(button => { button.disabled = false; });
    }
}

function openReturnForm(order) {
    const container = document.getElementById('returnItems');
    container.replaceChildren();
    order.itens.forEach(item => {
        const pending = item.qnt_solicitada - (item.qnt_devolvida || 0);
        if (pending <= 0) return;
        const row = createElement('div', 'return-item');
        row.dataset.productId = item.id_produto;
        row.dataset.expectedReturned = item.qnt_devolvida || 0;
        row.append(
            createElement('h4', null, item.nome),
            createElement('p', 'return-help', `${pending} unidade(s) a receber. Já recebidas: ${item.qnt_devolvida || 0}; danificadas: ${item.qnt_danificada || 0}.`)
        );
        const fields = createElement('div', 'return-fields');
        [['quantity', 'Recebidas agora', pending], ['damagedQuantity', 'Danificadas dentre as recebidas', 0]].forEach(([name, text, max]) => {
            const label = createElement('label', null, text);
            const input = createElement('input');
            input.type = 'number';
            input.name = name;
            input.min = '0';
            input.max = String(max);
            input.step = '1';
            input.value = '0';
            input.inputMode = 'numeric';
            input.required = true;
            input.setAttribute('aria-label', `${text}: ${item.nome}`);
            label.appendChild(input);
            fields.appendChild(label);
        });
        row.appendChild(fields);
        container.appendChild(row);
    });
    document.getElementById('returnNotes').value = '';
    document.getElementById('returnSection').hidden = false;
    document.getElementById('modalActions').hidden = true;
    updateReturnForm();
    container.querySelector('input')?.focus();
    document.getElementById('returnSection').scrollIntoView({ block: 'start' });
}

function getReturnItems() {
    return [...document.querySelectorAll('#returnItems .return-item')].map(row => ({
        productId: Number(row.dataset.productId),
        expectedReturned: Number(row.dataset.expectedReturned),
        quantity: Number(row.querySelector('[name="quantity"]').value),
        damagedQuantity: Number(row.querySelector('[name="damagedQuantity"]').value)
    }));
}

function updateReturnForm() {
    document.querySelectorAll('#returnItems .return-item').forEach(row => {
        row.querySelector('[name="damagedQuantity"]').max = row.querySelector('[name="quantity"]').value || '0';
    });
    const items = getReturnItems();
    const received = items.reduce((total, item) => total + item.quantity, 0);
    const damaged = items.reduce((total, item) => total + item.damagedQuantity, 0);
    const valid = document.getElementById('returnForm').checkValidity();
    document.getElementById('confirmReturn').disabled = busy || received <= 0 || !valid;
    document.getElementById('returnSummary').textContent = !valid
        ? 'Confira as quantidades: use números inteiros dentro dos limites informados; as danificadas devem fazer parte das recebidas.'
        : received > 0 ? `${received} unidade(s) recebida(s), ${damaged} danificada(s). ${received - damaged} voltará(ão) ao estoque disponível. O pedido permanece em Retirado enquanto houver itens faltantes.`
            : 'Informe ao menos uma unidade recebida para confirmar a devolução.';
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
    } else if (action !== 'register_return' && !confirm('Confirma esta mudança de status?')) {
        return;
    }

    busy = true;
    let updated = false;
    document.getElementById('ordersGrid').setAttribute('aria-busy', 'true');
    document.getElementById('historyGrid').setAttribute('aria-busy', 'true');
    if (action === 'register_return') document.getElementById('confirmReturn').disabled = true;
    try {
        await transitionPedido(order.id_pedido, action, reason,
            action === 'register_return' ? getReturnItems().filter(item => item.quantity > 0) : undefined,
            action === 'register_return' ? document.getElementById('returnNotes').value.trim() : undefined
        );
        closeModal();
        await loadOrders();
        updated = true;
        if (TERMINAL_STATUSES.has(orders.find(item => item.id_pedido === order.id_pedido)?.status)) {
            document.getElementById('ordersHistory').open = true;
            document.getElementById('historyPeriod').value = 'all';
            document.getElementById('historyStatus').value = 'all';
            const { historyOrders } = selectOrders(orders, document.querySelector('.search-bar input').value, 'all', 'all');
            historyLimit = Math.max(historyLimit, historyOrders.findIndex(item => item.id_pedido === order.id_pedido) + 1);
        }
    } catch (error) {
        alert(error.message || 'Não foi possível atualizar o pedido.');
    } finally {
        busy = false;
        document.getElementById('ordersGrid').setAttribute('aria-busy', 'false');
        document.getElementById('historyGrid').setAttribute('aria-busy', 'false');
        if (!document.getElementById('returnSection').hidden) updateReturnForm();
        renderOrders();
        if (updated) document.querySelector(`[data-order-id="${order.id_pedido}"]`)?.focus();
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
            const buttons = [...document.querySelectorAll('#orderModal button:not(:disabled), #orderModal input, #orderModal textarea')].filter(element => element.getClientRects().length);
            const first = buttons[0], last = buttons.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    });
    document.querySelector('.search-bar input').addEventListener('input', (event) => {
        historyLimit = HISTORY_PAGE_SIZE;
        if (event.target.value.trim()) document.getElementById('ordersHistory').open = true;
        renderOrders();
    });
    ['historyPeriod', 'historyStatus'].forEach(id => document.getElementById(id).addEventListener('change', () => {
        historyLimit = HISTORY_PAGE_SIZE;
        renderOrders();
    }));
    document.getElementById('historyMore').addEventListener('click', () => {
        historyLimit += HISTORY_PAGE_SIZE;
        renderOrders();
    });
    document.getElementById('returnForm').addEventListener('input', updateReturnForm);
    document.getElementById('returnForm').addEventListener('submit', (event) => {
        event.preventDefault();
        updateReturnForm();
        if (!document.getElementById('confirmReturn').disabled) runAction('register_return');
    });
    document.getElementById('cancelReturn').addEventListener('click', () => {
        document.getElementById('returnSection').hidden = true;
        document.getElementById('modalActions').hidden = false;
        document.querySelector('#modalActions button')?.focus();
    });
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('orderModal').addEventListener('click', (event) => {
        if (event.target.id === 'orderModal') closeModal();
    });

    try {
        await loadOrders();
    } catch (error) {
        console.error('Erro ao carregar gestão de pedidos:', error);
        document.getElementById('ordersSummary').textContent = 'Não foi possível carregar os pedidos.';
        document.getElementById('ordersGrid').appendChild(
            createElement('p', 'empty-state', error.message || 'Não foi possível carregar os pedidos.')
        );
    }
});
