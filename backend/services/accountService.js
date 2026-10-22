import sql from '../db.js';
import { normalizeDisplayName } from './userProfile.js';
import { enqueueNotification } from './notificationService.js';

export class AccountValidationError extends Error {}
export class AccountPermissionError extends Error {}
export class AccountNotFoundError extends Error {}
export class AccountConflictError extends Error {}

function normalizeId(value) {
    if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
        throw new AccountValidationError('Usuário inválido.');
    }
    return Number(value);
}

export async function listManagedUsers({ search = '', page = '1', limit = '20' } = {}) {
    if (typeof search !== 'string' || search.length > 100 || !/^\d+$/.test(String(page)) || !/^\d+$/.test(String(limit))) {
        throw new AccountValidationError('Informe uma pesquisa de até 100 caracteres e uma página válida.');
    }
    const normalizedPage = Number(page), normalizedLimit = Number(limit);
    if (!Number.isSafeInteger(normalizedPage) || normalizedPage < 1 || !Number.isSafeInteger(normalizedLimit) || normalizedLimit < 1 || normalizedLimit > 50 || !Number.isSafeInteger((normalizedPage - 1) * normalizedLimit)) {
        throw new AccountValidationError('Página inválida; use entre 1 e 50 usuários por página.');
    }
    const term = search.trim();
    const [count] = await sql`SELECT count(*)::int AS total FROM usuario
        WHERE ${term} = '' OR strpos(lower(nome), lower(${term})) > 0 OR strpos(lower(email), lower(${term})) > 0`;
    const usuarios = await sql`SELECT id_usuario, nome, email, nivel_acesso, status_conta,
        motivo_bloqueio, data_bloqueio, bloqueio_automatico_ate::text,
        COALESCE(bloqueio_automatico_ate > current_date, false) AS bloqueio_automatico_ativo
        FROM usuario
        WHERE ${term} = '' OR strpos(lower(nome), lower(${term})) > 0 OR strpos(lower(email), lower(${term})) > 0
        ORDER BY lower(nome), id_usuario LIMIT ${normalizedLimit} OFFSET ${(normalizedPage - 1) * normalizedLimit}`;
    return { usuarios, total: count.total, page: normalizedPage, limit: normalizedLimit, totalPages: Math.ceil(count.total / normalizedLimit) };
}

export async function getManagedUser(userId) {
    const id = normalizeId(userId);
    const [user] = await sql`SELECT id_usuario, nome, email, nivel_acesso, status_conta,
        motivo_bloqueio, data_bloqueio, bloqueio_automatico_ate::text,
        COALESCE(bloqueio_automatico_ate > current_date, false) AS bloqueio_automatico_ativo
        FROM usuario WHERE id_usuario = ${id}`;
    if (!user) throw new AccountNotFoundError('Usuário não encontrado.');
    return user;
}

export async function updateManagedUser(actorId, userId, input, { ip } = {}) {
    const actor = normalizeId(actorId), target = normalizeId(userId);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['name', 'accessLevel', 'active', 'reason', 'clearAutomaticPenalty'].includes(key))) {
        throw new AccountValidationError('Informe somente nome, nível de acesso e bloqueio da conta.');
    }
    if (input.accessLevel !== undefined && ![0, 1, 2].includes(input.accessLevel)) throw new AccountValidationError('Nível de acesso inválido.');
    if (input.active !== undefined && typeof input.active !== 'boolean') throw new AccountValidationError('Situação da conta inválida.');
    if (input.clearAutomaticPenalty !== undefined && typeof input.clearAutomaticPenalty !== 'boolean') throw new AccountValidationError('Liberação de penalidade inválida.');
    let name;
    if (input.name !== undefined) {
        try { name = normalizeDisplayName(input.name); } catch (error) { throw new AccountValidationError(error.message); }
    }
    if (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.trim().length > 500)) throw new AccountValidationError('O motivo deve ter até 500 caracteres.');
    const reason = input.reason?.trim() || '';
    return sql.begin(async db => {
        // Serializa mudanças de administradores para que duas sessões não removam o último acesso.
        await db`SELECT pg_advisory_xact_lock(73410529)`;
        const users = await db`SELECT id_usuario, nome, nivel_acesso, status_conta, motivo_bloqueio,
            bloqueio_automatico_ate::text, COALESCE(bloqueio_automatico_ate > current_date, false) AS bloqueio_automatico_ativo
            FROM usuario WHERE id_usuario IN (${actor}, ${target}) ORDER BY id_usuario FOR NO KEY UPDATE`;
        const acting = users.find(user => Number(user.id_usuario) === actor);
        const previous = users.find(user => Number(user.id_usuario) === target);
        if (!acting || acting.nivel_acesso !== 2 || !acting.status_conta || acting.bloqueio_automatico_ativo) throw new AccountPermissionError('Somente administradores ativos podem alterar usuários.');
        if (!previous) throw new AccountNotFoundError('Usuário não encontrado.');
        const level = input.accessLevel ?? previous.nivel_acesso;
        const active = input.active ?? previous.status_conta;
        if (actor === target && (!active || level !== 2)) throw new AccountConflictError('Você não pode bloquear nem retirar seu próprio acesso de administrador.');
        if (previous.nivel_acesso === 2 && !active) throw new AccountConflictError('Não é permitido bloquear outro administrador.');
        if (level === 2 && !active) throw new AccountConflictError('Uma conta de administrador deve permanecer liberada.');
        const securityChange = level !== previous.nivel_acesso || active !== previous.status_conta || input.clearAutomaticPenalty === true;
        if ((securityChange || !active) && reason.length < 3) throw new AccountValidationError('Informe um motivo de 3 a 500 caracteres para alterar o acesso ou bloqueio.');
        if (previous.nivel_acesso === 2 && level !== 2) {
            const [{ total }] = await db`SELECT count(*)::int AS total FROM usuario WHERE nivel_acesso = 2 AND status_conta = true`;
            if (total < 2) throw new AccountConflictError('O sistema precisa manter ao menos um administrador ativo.');
        }
        const [updated] = await db`UPDATE usuario SET nome = ${name ?? previous.nome}, nivel_acesso = ${level},
            status_conta = ${active}, motivo_bloqueio = ${active ? null : reason},
            data_bloqueio = CASE WHEN ${active} THEN NULL WHEN status_conta THEN now() ELSE data_bloqueio END,
            bloqueio_automatico_ate = CASE WHEN ${input.clearAutomaticPenalty === true || level === 2} THEN NULL ELSE bloqueio_automatico_ate END,
            session_version = session_version + ${securityChange ? 1 : 0}
            WHERE id_usuario = ${target}
            RETURNING id_usuario, nome, email, nivel_acesso, status_conta, motivo_bloqueio, data_bloqueio,
                bloqueio_automatico_ate::text, COALESCE(bloqueio_automatico_ate > current_date, false) AS bloqueio_automatico_ativo`;
        const [audit] = await db`INSERT INTO log_auditoria (acao, tabela_afetada, dados_anteriores, dados_posteriores, ip, id_usuario)
            VALUES ('usuario:alterar', 'usuario', ${JSON.stringify(previous)},
                ${JSON.stringify({ ...updated, motivo_alteracao: reason || null })}, ${ip || null}, ${actor}) RETURNING id_log`;
        await enqueueNotification(db, { userId: target, eventKey: `usuario:${target}:alteracao:${audit.id_log}`, href: '/perfil',
            message: `A administração atualizou sua conta. ${active ? 'Situação manual: liberada.' : `Conta bloqueada. Motivo: ${reason}.`} Nível: ${['solicitante', 'técnico', 'administrador'][level]}.${input.clearAutomaticPenalty ? ' O bloqueio por atraso foi encerrado.' : ''}` });
        return updated;
    });
}

export async function applyLateReturnPenalty(db, { userId, orderId, dueDate, actorId, ip }) {
    const [user] = await db`SELECT nivel_acesso, bloqueio_automatico_ate::text FROM usuario WHERE id_usuario = ${userId} FOR NO KEY UPDATE`;
    if (!user || user.nivel_acesso === 2) return null;
    const [dates] = await db`SELECT current_date::text AS today, (current_date - ${dueDate}::date)::int AS days,
        GREATEST(current_date, ${user.bloqueio_automatico_ate}::date)::text AS start`;
    if (dates.days <= 0) return null;
    const [penalty] = await db`INSERT INTO penalidade_atraso (id_pedido, id_usuario, data_prevista, data_devolucao, dias_bloqueio, inicio_bloqueio, fim_bloqueio)
        VALUES (${orderId}, ${userId}, ${dueDate}::date, current_date, ${dates.days}, ${dates.start}::date, ${dates.start}::date + ${dates.days}::int)
        ON CONFLICT (id_pedido) DO NOTHING RETURNING dias_bloqueio, fim_bloqueio::text AS bloqueio_automatico_ate`;
    if (!penalty) return null;
    await db`UPDATE usuario SET bloqueio_automatico_ate = ${penalty.bloqueio_automatico_ate}::date,
        session_version = session_version + 1 WHERE id_usuario = ${userId}`;
    await db`INSERT INTO log_auditoria (acao, tabela_afetada, dados_anteriores, dados_posteriores, ip, id_usuario)
        VALUES ('usuario:bloqueio_atraso', 'usuario', ${JSON.stringify({ id_usuario: userId, bloqueio_automatico_ate: user.bloqueio_automatico_ate })},
            ${JSON.stringify({ id_usuario: userId, id_pedido: orderId, data_prevista: dueDate, ...penalty })}, ${ip || null}, ${actorId || null})`;
    await enqueueNotification(db, { userId, eventKey: `pedido:${orderId}:penalidade`, href: '/perfil',
        message: `A devolução do pedido #${orderId} teve ${dates.days} dia(s) de atraso. Sua conta está bloqueada por atraso até ${penalty.bloqueio_automatico_ate.split('-').reverse().join('/')}. A liberação é automática nessa data.` });
    return penalty;
}
