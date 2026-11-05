import {
    cancelPedido,
    checkoutCarrinho,
    formatDate,
    getCarrinho,
    getPedidos,
    solicitarRenovacao,
    pedirNovamente,
    removeItemCarrinho,
    updateItemCarrinho
} from './api.js';

const FALLBACK_IMAGE = '/assets/electronic_components_1_1774913851066.png';
const TERMINAL_STATUSES = new Set(['Devolvido', 'Negado', 'Cancelado', 'Expirado']);
let orders = [];
let selectedOrder = null;
let modalTrigger = null;
let orderBusy = false;
let cartBusy = false;

function showModal(modal) {
    modalTrigger = document.activeElement;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    modal.querySelector('button').focus();
}

function hideModal(modal) {
    if (modal.style.display !== 'flex') return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
    modalTrigger?.focus();
}

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function renderEmpty(container, message) {
    container.replaceChildren(createElement('p', 'empty-state', message));
}

async function loadCart(focus = document.activeElement) {
    const container = document.getElementById('cartItems');
    const checkoutButton = document.getElementById('checkoutButton');
    const focusedRow = container.contains(focus) ? focus.closest('[data-product-id]') : null;
    const focusedIndex = [...container.children].indexOf(focusedRow);
    const items = await getCarrinho();
    const restoreFocus = focusedRow && [focus, document.body].includes(document.activeElement);
    container.replaceChildren();
    checkoutButton.disabled = items.length === 0;

    if (items.length === 0) {
        renderEmpty(container, 'Seu carrinho está vazio. Adicione itens pelo catálogo.');
        if (restoreFocus) {
            container.firstElementChild.tabIndex = -1;
            container.firstElementChild.focus();
        }
        return;
    }

    items.forEach((item) => {
        const row = createElement('div', 'table-row');
        row.dataset.productId = item.id_produto;
        const productInfo = createElement('div', 'product-info');
        const image = document.createElement('img');
        image.className = 'product-thumb';
        image.src = item.foto_produto || FALLBACK_IMAGE;
        image.alt = `Foto de ${item.nome}`;
        image.referrerPolicy = 'no-referrer';
        image.onerror = () => {
            image.onerror = null;
            image.src = FALLBACK_IMAGE;
        };

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
        minus.dataset.cartAction = 'minus';
        plus.dataset.cartAction = 'plus';
        minus.setAttribute('aria-label', `Diminuir quantidade de ${item.nome}`);
        plus.setAttribute('aria-label', `Aumentar quantidade de ${item.nome}`);
        minus.disabled = item.quantidade <= 1;
        plus.disabled = item.quantidade >= item.estoque_total;

        minus.addEventListener('click', event => changeQuantity(item, item.quantidade - 1, event.currentTarget));
        plus.addEventListener('click', event => changeQuantity(item, item.quantidade + 1, event.currentTarget));
        quantity.append(minus, value, plus);

        const remove = createElement('button', 'delete-btn', 'Remover');
        remove.type = 'button';
        remove.dataset.cartAction = 'remove';
        remove.addEventListener('click', event => saveCartChange(event.currentTarget, () => removeItemCarrinho(item.id_produto)));

        actions.append(quantity, remove);
        row.append(productInfo, actions);
        container.appendChild(row);
    });
    if (restoreFocus) {
        const row = [...container.children].find(node => node.dataset.productId === focusedRow.dataset.productId)
            || container.children[Math.min(focusedIndex, container.children.length - 1)];
        const action = row.querySelector(`[data-cart-action="${focus.dataset.cartAction}"]:not(:disabled)`)
            || row.querySelector('button:not(:disabled)');
        action?.focus();
    }
}

async function saveCartChange(focus, save) {
    if (cartBusy) return;
    cartBusy = true;
    const container = document.getElementById('cartItems');
    const feedback = document.getElementById('cartFeedback');
    const checkoutButton = document.getElementById('checkoutButton');
    const checkoutDisabled = checkoutButton.disabled;
    const controls = [...container.querySelectorAll('button')];
    const disabled = controls.map(button => button.disabled);
    controls.forEach(button => { button.disabled = true; });
    checkoutButton.disabled = true;
    container.setAttribute('aria-busy', 'true');
    feedback.textContent = 'Atualizando carrinho…';
    try {
        await save();
        await loadCart(focus);
        feedback.textContent = 'Carrinho atualizado.';
    } catch (error) {
        feedback.textContent = error.message || 'Não foi possível atualizar o carrinho. Tente novamente.';
    } finally {
        cartBusy = false;
        container.setAttribute('aria-busy', 'false');
        controls.forEach((button, index) => {
            if (button.isConnected) button.disabled = disabled[index];
        });
        checkoutButton.disabled = checkoutDisabled || !container.querySelector('[data-product-id]');
        if (focus.isConnected && document.activeElement === document.body) focus.focus();
    }
}

async function changeQuantity(item, quantity, focus) {
    await saveCartChange(focus, () => updateItemCarrinho(item.id_produto, quantity));
}

function getStudentStatusBadge(status) {
    switch (status) {
        case 'Pendente':
            return { className: 'status-icon yellow', symbol: '!' };
        case 'Aprovado':
        case 'Pronto para retirada':
        case 'Devolvido':
            return { className: 'status-icon green', symbol: '✓' };
        case 'Em separação':
            return { className: 'status-icon blue', symbol: '⟳' };
        case 'Retirado':
            return { className: 'status-icon blue', symbol: '⏱' };
        case 'Negado':
        case 'Cancelado':
        case 'Expirado':
            return { className: 'status-icon red', symbol: '✕' };
        default:
            return { className: 'status-icon yellow', symbol: '!' };
    }
}

function createOrderCard(order, compact = false) {
    const card = createElement('button', compact ? 'card ongoing-card' : 'card history-card');
    card.type = 'button';

    if (compact) {
        const info = createElement('div', 'ongoing-info');
        info.append(
            createElement('strong', null, `Pedido #${order.id_pedido}`),
            createElement('span', 'ongoing-status', order.status),
            createElement('span', 'devolution-date', order.data_prevista_devolucao
                ? `Devolução prevista: ${formatDate(order.data_prevista_devolucao)}`
                : order.data_limite_retirada
                    ? `Retirar até: ${formatDate(order.data_limite_retirada)}`
                    : `Solicitado em: ${formatDate(order.data_pedido)}`)
        );
        const badgeInfo = getStudentStatusBadge(order.status);
        if (order.renovacoes?.some(renewal => renewal.status === 'Pendente')) {
            info.appendChild(createElement('span', 'renewal-badge', 'Renovação em análise'));
        }
        card.append(info, createElement('div', badgeInfo.className, badgeInfo.symbol));
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
    hideModal(document.getElementById('modalPedido'));
    selectedOrder = null;
}

function openOrderModal(order) {
    selectedOrder = order;
    document.getElementById('renewalForm').hidden = true;
    document.getElementById('renewalFeedback').textContent = '';
    document.getElementById('modalNumPedido').textContent = `Pedido #${order.id_pedido}`;
    document.getElementById('modalStatus').textContent = order.status;
    document.getElementById('modalData').textContent = formatDate(order.data_pedido);
    document.getElementById('modalReservation').textContent = order.data_retirada
        ? `Retirado em: ${formatDate(order.data_retirada)} · Devolução até: ${formatDate(order.data_prevista_devolucao)}`
        : order.data_limite_retirada ? `Prazo para retirada: ${formatDate(order.data_limite_retirada)} (10 dias após a aprovação)` : '';
    
    const justificationEl = document.getElementById('modalJustification');
    if (justificationEl) {
        if (order.justificativa) {
            justificationEl.textContent = `Motivo informado: ${order.justificativa}`;
            justificationEl.style.display = 'block';
        } else {
            justificationEl.textContent = '';
            justificationEl.style.display = 'none';
        }
    }

    document.getElementById('modalReason').textContent = order.motivo_recusa
        ? `Justificativa de recusa: ${order.motivo_recusa}`
        : '';

    const itemsContainer = document.getElementById('modalOrderItems');
    itemsContainer.replaceChildren();
    order.itens.forEach((item) => {
        const row = createElement('div', 'modal-item-row');
        const info = createElement('div', 'modal-prod-info');
        const image = document.createElement('img');
        image.src = item.foto_produto || FALLBACK_IMAGE;
        image.alt = `Foto de ${item.nome}`;
        image.onerror = () => {
            image.onerror = null;
            image.src = FALLBACK_IMAGE;
        };
        const details = createElement('div', 'modal-prod-details');
        details.append(
            createElement('strong', null, item.nome),
            createElement('span', null, `Cor: ${item.cor || 'não informada'}`)
        );
        if (order.data_retirada) {
            const returned = item.qnt_devolvida || 0;
            details.append(createElement('span', 'return-summary', `Recebidas: ${returned} · Danificadas: ${item.qnt_danificada || 0} · Pendentes: ${item.qnt_solicitada - returned}`));
        }
        info.append(image, details);
        row.append(info, createElement('div', 'modal-qty-badge', `${item.qnt_solicitada} un.`));
        itemsContainer.appendChild(row);
    });

    const returnsContainer = document.getElementById('studentOrderReturns');
    returnsContainer.replaceChildren();
    if (order.devolucoes?.length) {
        returnsContainer.appendChild(createElement('h3', 'modal-subtitle', 'Registro de devoluções'));
        order.devolucoes.forEach((entry) => {
            const record = createElement('div', 'return-record');
            record.appendChild(createElement('strong', null, formatDate(entry.data)));
            entry.itens.forEach((item) => {
                const product = order.itens.find((product) => String(product.id_produto) === String(item.id_produto));
                record.appendChild(createElement('p', null, `${product?.nome || `Item #${item.id_produto}`}: ${item.quantidade} recebida(s), ${item.danificada} danificada(s).`));
            });
            if (entry.observacao) record.appendChild(createElement('p', null, `Ocorrência: ${entry.observacao}`));
            returnsContainer.appendChild(record);
        });
    }

    const actions = document.getElementById('studentOrderActions');
    actions.replaceChildren();
    const renewals = document.getElementById('studentRenewals');
    renewals.replaceChildren();
    if (order.renovacoes?.length) {
        renewals.appendChild(createElement('h3', 'modal-subtitle', 'Renovações'));
        order.renovacoes.forEach(renewal => {
            const record = createElement('div', 'return-record');
            record.append(createElement('strong', null, `${renewal.status} · Prazo solicitado: ${formatDate(renewal.data_estendida)}`),
                createElement('p', null, `Justificativa: ${renewal.justificativa_estendimento}`));
            if (renewal.motivo_recusa) record.appendChild(createElement('p', null, `Motivo: ${renewal.motivo_recusa}`));
            renewals.appendChild(record);
        });
    }
    const approvedRenewals = (order.renovacoes || []).filter(renewal => renewal.status === 'Aprovada').length;
    if (order.status === 'Retirado' && approvedRenewals < 2 && !order.renovacoes?.some(renewal => renewal.status === 'Pendente')) {
        const renew = createElement('button', 'action-btn', 'Solicitar renovação');
        renew.type = 'button';
        renew.addEventListener('click', () => {
            const date = document.getElementById('renewalDate');
            const due = String(order.data_prevista_devolucao).slice(0, 10);
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
            date.min = new Date(Date.parse(due > today ? due : today) + 86_400_000).toISOString().slice(0, 10);
            date.max = new Date(Date.parse(due) + 15 * 86_400_000).toISOString().slice(0, 10);
            date.value = date.min <= date.max ? date.min : '';
            document.getElementById('renewalJustification').value = '';
            document.getElementById('renewalForm').hidden = false;
            date.focus();
        });
        actions.appendChild(renew);
    }
    const repeat = createElement('button', 'action-btn', 'Pedir novamente');
    repeat.type = 'button';
    repeat.addEventListener('click', async () => {
        if (orderBusy) return;
        orderBusy = true;
        repeat.disabled = true;
        try {
            const result = await pedirNovamente(order.id_pedido);
            await loadCart();
            closeOrderModal();
            document.getElementById('cartItems').scrollIntoView({ block: 'start' });
            const feedback = document.getElementById('cartFeedback');
            feedback.textContent = `${result.addedQuantity} unidade(s) adicionada(s) ao carrinho. Confira os itens e aceite o termo para enviar um novo pedido.${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`;
            feedback.focus();
        } catch (error) {
            document.getElementById('renewalFeedback').textContent = error.message || 'Não foi possível copiar o pedido.';
        } finally { orderBusy = false; repeat.disabled = false; }
    });
    actions.appendChild(repeat);
    if (['Pendente', 'Aprovado', 'Em separação', 'Pronto para retirada'].includes(order.status)) {
        const cancel = createElement('button', 'action-btn', 'Cancelar solicitação');
        cancel.type = 'button';
        cancel.addEventListener('click', cancelSelectedOrder);
        actions.appendChild(cancel);
    }

    showModal(document.getElementById('modalPedido'));
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

function openTermsModal() {
    const modal = document.getElementById('modalTermos');
    if (modal) showModal(modal);
}

function closeTermsModal() {
    const modal = document.getElementById('modalTermos');
    if (modal) hideModal(modal);
}

document.addEventListener('DOMContentLoaded', async () => {
    const checkoutButton = document.getElementById('checkoutButton');
    const modal = document.getElementById('modalPedido');
    const termsModal = document.getElementById('modalTermos');
    const openTermsLink = document.getElementById('openTermsModal');
    const closeTermsModalBtn = document.getElementById('closeTermsModal');
    const btnCloseTermsModal = document.getElementById('btnCloseTermsModal');
    const btnAcceptTermsModal = document.getElementById('btnAcceptTermsModal');

    if (openTermsLink) {
        openTermsLink.addEventListener('click', (e) => {
            e.preventDefault();
            openTermsModal();
        });
    }

    if (closeTermsModalBtn) {
        closeTermsModalBtn.addEventListener('click', closeTermsModal);
    }

    if (btnCloseTermsModal) {
        btnCloseTermsModal.addEventListener('click', closeTermsModal);
    }

    if (btnAcceptTermsModal) {
        btnAcceptTermsModal.addEventListener('click', () => {
            const checkbox = document.getElementById('acceptTerms');
            if (checkbox) checkbox.checked = true;
            closeTermsModal();
        });
    }

    if (termsModal) {
        termsModal.addEventListener('click', (event) => {
            if (event.target === termsModal) closeTermsModal();
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeTermsModal();
            closeOrderModal();
        }
        if (event.key === 'Tab') {
            const activeModal = [termsModal, modal].find((dialog) => dialog.style.display === 'flex');
            if (!activeModal) return;
            const focusable = [...activeModal.querySelectorAll('button:not([disabled]), a[href], input, textarea, [tabindex="0"]')]
                .filter(element => element.getClientRects().length);
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    });

    checkoutButton.addEventListener('click', async () => {
        checkoutButton.disabled = true;

        try {
            const justification = document.getElementById('orderJustification')?.value || null;

            await checkoutCarrinho(
                document.getElementById('loanDuration').value,
                document.getElementById('acceptTerms').checked,
                justification,
                Number(termsModal?.dataset.termsVersion)
            );
            document.getElementById('acceptTerms').checked = false;
            const justificationInput = document.getElementById('orderJustification');
            if (justificationInput) justificationInput.value = '';

            await Promise.all([loadCart(), loadOrders()]);
            alert('Pedido enviado para aprovação.');
        } catch (error) {
            alert(error.message || 'Não foi possível concluir o pedido.');
            checkoutButton.disabled = false;
        }
    });

    document.getElementById('closeOrderModal').addEventListener('click', closeOrderModal);
    document.getElementById('cancelRenewal').addEventListener('click', () => {
        document.getElementById('renewalForm').hidden = true;
        document.querySelector('#studentOrderActions button')?.focus();
    });
    document.getElementById('renewalForm').addEventListener('submit', async event => {
        event.preventDefault();
        if (!selectedOrder || orderBusy) return;
        const button = document.getElementById('submitRenewal');
        orderBusy = true;
        button.disabled = true;
        try {
            const updated = await solicitarRenovacao(selectedOrder.id_pedido,
                document.getElementById('renewalDate').value, document.getElementById('renewalJustification').value);
            await loadOrders();
            openOrderModal(updated);
            document.getElementById('renewalFeedback').textContent = 'Renovação enviada para análise. O prazo atual continua valendo até a aprovação.';
        } catch (error) {
            document.getElementById('renewalFeedback').textContent = error.message || 'Não foi possível solicitar a renovação.';
        } finally { orderBusy = false; button.disabled = false; }
    });
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeOrderModal();
    });

    document.getElementById('historyTabs').addEventListener('click', (event) => {
        const tab = event.target.closest('.tab');
        if (!tab) return;
        document.querySelectorAll('#historyTabs .tab').forEach((item) => {
            item.classList.remove('active');
            item.setAttribute('aria-pressed', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-pressed', 'true');
        renderOrders(tab.dataset.filter);
    });

    try {
        await Promise.all([loadCart(), loadOrders()]);
        const id = new URLSearchParams(location.search).get('id_pedido');
        if (id) {
            const order = /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))
                ? orders.find(order => String(order.id_pedido) === id) : null;
            if (order) openOrderModal(order);
            else document.getElementById('cartFeedback').textContent = 'O pedido desta notificação não está disponível para sua conta.';
        }
    } catch (error) {
        console.error('Erro ao carregar pedidos:', error);
        alert(error.message || 'Não foi possível carregar seus pedidos.');
    }
});
