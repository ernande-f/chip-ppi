export class OrderValidationError extends Error {}

export const ORDER_STATUS = Object.freeze({
    PENDING: 'Pendente',
    APPROVED: 'Aprovado',
    SEPARATING: 'Em separação',
    READY: 'Pronto para retirada',
    PICKED_UP: 'Retirado',
    RETURNED: 'Devolvido',
    DENIED: 'Negado',
    CANCELLED: 'Cancelado'
});

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

export function normalizeReservationDates(start, end, today) {
    if ((start === undefined || start === null || start === '') && (end === undefined || end === null || end === '')) return null;
    for (const value of [start, end]) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
            throw new OrderValidationError('Informe datas válidas de retirada e devolução.');
        }
    }
    if (start < today) throw new OrderValidationError('A retirada prevista não pode estar no passado.');
    const duration = normalizeLoanDuration((Date.parse(end) - Date.parse(start)) / 86_400_000);
    return { start, end, duration };
}

export function normalizeLoanDuration(value) {
    const duration = Number(value);

    if (!Number.isInteger(duration) || duration < 1 || duration > 15) {
        throw new OrderValidationError('A duração do empréstimo deve ficar entre 1 e 15 dias.');
    }

    return duration;
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
