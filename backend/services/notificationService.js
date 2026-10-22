import sql from '../db.js';
import { getServerConfig } from '../config.js';

export class NotificationValidationError extends Error {}

export function getEmailConfig(env = process.env) {
    if (!['true', 'false', undefined, ''].includes(env.NOTIFICATION_EMAIL_ENABLED)) throw new Error('NOTIFICATION_EMAIL_ENABLED deve ser true ou false.');
    const enabled = env.NOTIFICATION_EMAIL_ENABLED === 'true';
    if (enabled && (!env.RESEND_API_KEY || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.EMAIL_FROM || ''))) {
        throw new Error('Configure RESEND_API_KEY e EMAIL_FROM antes de habilitar os e-mails.');
    }
    return { enabled, apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM };
}

function positiveId(value) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 1) throw new NotificationValidationError('Identificador de notificação inválido.');
    return id;
}

export async function enqueueNotification(db, { userId, eventKey, message, href = '/pedidos' }) {
    const id = positiveId(userId);
    if (typeof eventKey !== 'string' || !eventKey || eventKey.length > 220
        || typeof message !== 'string' || !message.trim() || message.length > 2000
        || !['/pedidos', '/pedidos.html', '/perfil', '/usuarios.html'].includes(href)) {
        throw new NotificationValidationError('Notificação inválida.');
    }
    const [notification] = await db`INSERT INTO notificacao (mensagem,href,chave_evento)
        VALUES (${message.trim()},${href},${`${id}:${eventKey}`}) ON CONFLICT (chave_evento) DO NOTHING RETURNING id_notificacao`;
    if (!notification) return null;
    await db`INSERT INTO notificar (id_usuario,id_notificacao) VALUES (${id},${notification.id_notificacao})`;
    const [user] = await db`SELECT email,auth_provider FROM usuario WHERE id_usuario = ${id}`;
    const enabled = getEmailConfig().enabled && user?.auth_provider === 'google' && !/\.(invalid|test|example)$/i.test(user.email || '');
    await db`INSERT INTO notificacao_email (id_usuario,id_notificacao,estado)
        VALUES (${id},${notification.id_notificacao},${enabled ? 'pendente' : 'desativado'})`;
    return notification.id_notificacao;
}

export async function enqueueStaffNotification(db, { eventKey, message, href = '/pedidos.html' }) {
    const staff = await db`SELECT id_usuario FROM usuario WHERE nivel_acesso IN (1,2) AND status_conta`;
    for (const user of staff) await enqueueNotification(db, { userId: user.id_usuario, eventKey, message, href });
}

export async function listNotifications(userId, { page = 1, unreadOnly = false } = {}) {
    const id = positiveId(userId);
    const pageNumber = positiveId(page);
    if (pageNumber > 1_000_000) throw new NotificationValidationError('Página inválida.');
    const onlyUnread = unreadOnly === true || unreadOnly === 'true';
    const [count] = await sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE lida_em IS NULL)::int AS nao_lidas
        FROM notificar WHERE id_usuario = ${id}`;
    const notifications = await sql`SELECT n.id_notificacao,n.mensagem,n.href,n.criada_em,r.lida_em
        FROM notificar r JOIN notificacao n USING (id_notificacao)
        WHERE r.id_usuario = ${id} AND (${!onlyUnread} OR r.lida_em IS NULL)
        ORDER BY n.criada_em DESC,n.id_notificacao DESC LIMIT 20 OFFSET ${(pageNumber - 1) * 20}`;
    const total = onlyUnread ? count.nao_lidas : count.total;
    return { notificacoes: notifications, nao_lidas: count.nao_lidas, total, page: pageNumber, totalPages: Math.ceil(total / 20) };
}

export async function markNotificationRead(userId, notificationId) {
    const id = positiveId(userId);
    const notification = positiveId(notificationId);
    const [row] = await sql`UPDATE notificar SET lida_em = COALESCE(lida_em,now())
        WHERE id_usuario = ${id} AND id_notificacao = ${notification} RETURNING id_notificacao`;
    return Boolean(row);
}

export async function markAllNotificationsRead(userId) {
    await sql`UPDATE notificar SET lida_em = now() WHERE id_usuario = ${positiveId(userId)} AND lida_em IS NULL`;
}

export async function enqueueDueReminders() {
    const orders = await sql`SELECT p.id_pedido FROM pedido p JOIN status_pedido s USING (id_status) WHERE s.descricao_status = 'Retirado'`;
    for (const order of orders) {
        await sql.begin(async db => {
            // A mesma trava das decisões impede avisos de um prazo que acabou de mudar.
            const [current] = await db`SELECT p.id_usuario,p.data_retirada::text,p.duracao_dias,s.descricao_status
                FROM pedido p JOIN status_pedido s USING (id_status) WHERE p.id_pedido = ${order.id_pedido} FOR UPDATE OF p`;
            if (current?.descricao_status !== 'Retirado') return;
            const [date] = await db`WITH prazo AS (SELECT GREATEST(
                (SELECT max(r.data_estendida) FROM renovacao r JOIN renovacao_pedido rp USING (id_renovacao)
                    WHERE rp.id_pedido = ${order.id_pedido} AND r.status = 'Aprovada'),
                ${current.data_retirada}::date + ${current.duracao_dias}::int) AS valor)
                SELECT valor::text AS prazo,valor - current_date AS dias FROM prazo`;
            if (![1, 2].includes(date.dias)) return;
            await enqueueNotification(db, {
                userId: current.id_usuario, eventKey: `lembrete:${order.id_pedido}:${date.prazo}:${date.dias}`,
                message: `O prazo de devolução do pedido #${order.id_pedido} termina em ${date.dias} dia(s), em ${date.prazo.split('-').reverse().join('/')}.`, href: '/pedidos'
            });
        });
    }
}

export async function sendNotificationEmail(job, { fetchImpl = fetch, config = getEmailConfig(), appUrl = getServerConfig().appUrl } = {}) {
    if (!config.enabled) return false;
    const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `chip:${job.id_usuario}:${job.id_notificacao}` },
        body: JSON.stringify({ from: config.from, to: [job.email], subject: 'CHIP — atualização do laboratório', text: `${job.mensagem}\n\nAcesse: ${appUrl}${job.href}` })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
}

export async function processNotificationEmails({ fetchImpl = fetch } = {}) {
    const config = getEmailConfig();
    if (!config.enabled) return;
    // A janela de tentativas fica abaixo das 24h de idempotência do provedor.
    await sql`UPDATE notificacao_email SET estado = 'falha',ultimo_erro = 'Janela de envio encerrada'
        WHERE estado IN ('pendente','enviando') AND (id_notificacao IN (SELECT id_notificacao FROM notificacao WHERE criada_em < now() - interval '20 hours')
            OR (tentativas >= 5 AND reservado_em < now() - interval '5 minutes'))`;
    for (let count = 0; count < 10; count++) {
        const job = await sql.begin(async db => {
            const [row] = await db`SELECT q.*,u.email,n.mensagem,n.href FROM notificacao_email q
                JOIN usuario u USING (id_usuario) JOIN notificacao n USING (id_notificacao)
                WHERE q.tentativas < 5 AND ((q.estado = 'pendente' AND q.disponivel_em <= now())
                    OR (q.estado = 'enviando' AND q.reservado_em < now() - interval '5 minutes'))
                ORDER BY q.disponivel_em,q.id_notificacao FOR UPDATE OF q SKIP LOCKED LIMIT 1`;
            if (!row) return null;
            await db`UPDATE notificacao_email SET estado = 'enviando',reservado_em = now(),tentativas = tentativas + 1
                WHERE id_notificacao = ${row.id_notificacao} AND id_usuario = ${row.id_usuario}`;
            return row;
        });
        if (!job) return;
        try {
            await sendNotificationEmail(job, { fetchImpl, config });
            await sql`UPDATE notificacao_email SET estado = 'enviado',enviado_em = now(),ultimo_erro = NULL
                WHERE id_notificacao = ${job.id_notificacao} AND id_usuario = ${job.id_usuario}`;
        } catch (error) {
            const failure = /^HTTP \d{3}$/.test(error.message) ? error.message : (error.name === 'TimeoutError' ? 'Timeout de envio' : 'Falha de conexão');
            const attempts = job.tentativas + 1;
            await sql`UPDATE notificacao_email SET estado = ${attempts >= 5 ? 'falha' : 'pendente'},ultimo_erro = ${failure},
                disponivel_em = now() + ${2 ** attempts} * interval '1 minute'
                WHERE id_notificacao = ${job.id_notificacao} AND id_usuario = ${job.id_usuario}`;
        }
    }
}

export async function getNotificationDeliveryStatus() {
    const counts = await sql`SELECT estado,count(*)::int AS total FROM notificacao_email GROUP BY estado ORDER BY estado`;
    return { habilitado: getEmailConfig().enabled, fila: counts };
}
