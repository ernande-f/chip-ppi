export class OrderValidationError extends Error {}
export class OrderConflictError extends Error {}

export const ORDER_STATUS = Object.freeze({
    PENDING: 'Pendente',
    APPROVED: 'Aprovado',
    SEPARATING: 'Em separação',
    READY: 'Pronto para retirada',
    PICKED_UP: 'Retirado',
    RETURNED: 'Devolvido',
    DENIED: 'Negado',
    CANCELLED: 'Cancelado',
    EXPIRED: 'Expirado'
});

export const PICKUP_WINDOW_DAYS = 10;
export const CURRENT_TERMS_VERSION = 3;

export const ORDER_ACTION = Object.freeze({
    APPROVE: 'approve',
    START_SEPARATION: 'start_separation',
    MARK_READY: 'mark_ready',
    CONFIRM_PICKUP: 'confirm_pickup',
    REGISTER_RETURN: 'register_return',
    DENY: 'deny',
    CANCEL: 'cancel'
});

const TRANSITIONS = new Map([
    [`${ORDER_STATUS.PENDING}:${ORDER_ACTION.APPROVE}`, ORDER_STATUS.APPROVED],
    [`${ORDER_STATUS.PENDING}:${ORDER_ACTION.DENY}`, ORDER_STATUS.DENIED],
    [`${ORDER_STATUS.PENDING}:${ORDER_ACTION.CANCEL}`, ORDER_STATUS.CANCELLED],
    [`${ORDER_STATUS.APPROVED}:${ORDER_ACTION.CANCEL}`, ORDER_STATUS.CANCELLED],
    [`${ORDER_STATUS.SEPARATING}:${ORDER_ACTION.CANCEL}`, ORDER_STATUS.CANCELLED],
    [`${ORDER_STATUS.READY}:${ORDER_ACTION.CANCEL}`, ORDER_STATUS.CANCELLED],
    [`${ORDER_STATUS.APPROVED}:${ORDER_ACTION.START_SEPARATION}`, ORDER_STATUS.SEPARATING],
    [`${ORDER_STATUS.SEPARATING}:${ORDER_ACTION.MARK_READY}`, ORDER_STATUS.READY],
    [`${ORDER_STATUS.READY}:${ORDER_ACTION.CONFIRM_PICKUP}`, ORDER_STATUS.PICKED_UP],
    [`${ORDER_STATUS.PICKED_UP}:${ORDER_ACTION.REGISTER_RETURN}`, ORDER_STATUS.RETURNED]
]);

export function validatePickupDeadline(approvalDate, today) {
    const approved = Date.parse(approvalDate);
    const current = Date.parse(today);
    if (!Number.isFinite(approved) || !Number.isFinite(current)) {
        throw new OrderValidationError('A data de aprovação do pedido não está registrada corretamente.');
    }
    if (current - approved > PICKUP_WINDOW_DAYS * 86_400_000) {
        throw new OrderValidationError('O prazo de 10 dias após a aprovação para retirar o pedido expirou.');
    }
}

export function normalizeLoanDuration(value) {
    const duration = Number(value);

    if (!Number.isInteger(duration) || duration < 1 || duration > 15) {
        throw new OrderValidationError('A duração do empréstimo deve ficar entre 1 e 15 dias.');
    }

    return duration;
}

export function validateRenewalDate(value, dueDate, today) {
    const requested = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(value) : NaN;
    const due = Date.parse(dueDate);
    const current = Date.parse(today);
    if (!Number.isFinite(requested) || new Date(requested).toISOString().slice(0, 10) !== value
        || !Number.isFinite(due) || !Number.isFinite(current)
        || requested <= due || requested <= current || requested - due > 15 * 86_400_000) {
        throw new OrderValidationError('Informe uma data futura, posterior ao prazo atual e até 15 dias depois dele.');
    }
    return value;
}

export function normalizeRenewalJustification(value) {
    const justification = normalizeOrderJustification(value);
    if (!justification) throw new OrderValidationError('Informe a justificativa para solicitar a renovação.');
    return justification;
}

export function normalizeCartQuantity(value, availableStock) {
    const quantity = Number(value);
    const available = Number(availableStock);

    if (!Number.isInteger(quantity) || quantity < 1) {
        throw new OrderValidationError('Informe uma quantidade válida para o carrinho.');
    }

    if (!Number.isInteger(available) || quantity > available) {
        throw new OrderValidationError('A quantidade solicitada supera o estoque disponível.');
    }

    return quantity;
}

export function validateTransitionReason(action, reason) {
    if (action !== ORDER_ACTION.DENY) {
        return null;
    }

    const normalizedReason = typeof reason === 'string' ? reason.trim() : '';

    if (!normalizedReason) {
        throw new OrderValidationError('Informe uma justificativa para negar o pedido.');
    }

    return normalizedReason.slice(0, 1000);
}

export function getNextOrderStatus(currentStatus, action) {
    const nextStatus = TRANSITIONS.get(`${currentStatus}:${action}`);

    if (!nextStatus) {
        throw new OrderValidationError(`Transição não permitida para um pedido com status "${currentStatus}".`);
    }

    return nextStatus;
}

export function normalizeOrderJustification(value) {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value !== 'string') {
        throw new OrderValidationError('O motivo do pedido deve ser um texto válido.');
    }

    const trimmed = value.trim();

    if (!trimmed) {
        return null;
    }

    if (trimmed.length > 500) {
        throw new OrderValidationError('O motivo do pedido deve ter no máximo 500 caracteres.');
    }

    return trimmed;
}

export function normalizeReturnItems(orderItems, submittedItems) {
    const items = submittedItems === undefined
        ? orderItems.filter(item => item.qnt_solicitada > item.qnt_devolvida).map(item => ({
            productId: item.id_produto,
            quantity: item.qnt_solicitada - item.qnt_devolvida,
            damagedQuantity: 0,
            expectedReturned: item.qnt_devolvida
        }))
        : submittedItems;
    if (!Array.isArray(items) || items.length === 0 || items.length > orderItems.length) {
        throw new OrderValidationError('Informe as quantidades recebidas nesta devolução.');
    }
    const seen = new Set();
    const normalized = items.map(item => {
        const productId = Number(item?.productId);
        const product = orderItems.find(product => Number(product.id_produto) === productId);
        if (!['number', 'string'].includes(typeof item?.productId)
            || !Number.isSafeInteger(productId) || productId < 1 || !product || seen.has(productId)) {
            throw new OrderValidationError('A devolução contém um item inválido ou repetido.');
        }
        seen.add(productId);
        const { quantity, damagedQuantity } = item;
        if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(damagedQuantity)
            || quantity < 0 || damagedQuantity < 0 || damagedQuantity > quantity
            || quantity > product.qnt_solicitada - product.qnt_devolvida) {
            throw new OrderValidationError('Confira as quantidades recebidas e danificadas: elas não podem superar as unidades ainda pendentes.');
        }
        if (!Number.isSafeInteger(item.expectedReturned) || item.expectedReturned < 0) {
            throw new OrderValidationError('Recarregue o pedido para conferir as quantidades já recebidas antes de registrar a devolução.');
        }
        if (item.expectedReturned !== product.qnt_devolvida) {
            throw new OrderConflictError('Esta devolução já foi registrada ou o pedido mudou. Recarregue o pedido antes de registrar outro recebimento.');
        }
        return { id_produto: product.id_produto, quantidade: quantity, danificada: damagedQuantity };
    });
    if (!normalized.some(item => item.quantidade > 0)) {
        throw new OrderValidationError('Registre pelo menos uma unidade recebida.');
    }
    return normalized.filter(item => item.quantidade > 0);
}

export function normalizeReturnNotes(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || value.trim().length > 1000) {
        throw new OrderValidationError('A observação da devolução deve ser um texto de até 1000 caracteres.');
    }
    return value.trim() || null;
}
