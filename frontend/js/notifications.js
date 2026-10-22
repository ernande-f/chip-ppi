import { apiRequest, getSession, getNotificacoes, lerNotificacao, lerTodasNotificacoes } from './api.js';

let page = 1;
let busy = false;
const el = id => document.getElementById(id);
const create = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };

async function loadNotifications() {
    if (busy) return;
    busy = true;
    el('notificationsList').setAttribute('aria-busy', 'true');
    el('readAll').disabled = true;
    el('unreadOnly').disabled = true;
    el('previousPage').disabled = true;
    el('nextPage').disabled = true;
    try {
        let data = await getNotificacoes({ page, unreadOnly: el('unreadOnly').checked });
        if (page > 1 && !data.notificacoes.length) {
            page = Math.max(1, data.totalPages);
            data = await getNotificacoes({ page, unreadOnly: el('unreadOnly').checked });
        }
        el('notificationsList').replaceChildren();
        for (const notification of data.notificacoes) {
            const card = document.createElement('article');
            card.className = `notification-card${notification.lida_em ? '' : ' unread'}`;
            card.append(create('strong', notification.lida_em ? 'Lida' : 'Não lida'));
            const time = create('time', new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(notification.criada_em)));
            time.dateTime = notification.criada_em;
            card.append(create('p', notification.mensagem), time);
            const actions = document.createElement('div');
            actions.className = 'notification-controls';
            const link = create('a', 'Ver detalhes');
            link.href = ['/pedidos', '/pedidos.html', '/perfil', '/usuarios.html'].includes(notification.href) ? notification.href : '/pedidos';
            actions.append(link);
            if (!notification.lida_em) {
                const read = create('button', 'Marcar como lida');
                read.type = 'button';
                read.addEventListener('click', async () => {
                    read.disabled = true;
                    try { await lerNotificacao(notification.id_notificacao); await loadNotifications(); }
                    catch (error) { el('notificationStatus').textContent = error.message; read.disabled = false; }
                });
                actions.append(read);
            }
            card.append(actions);
            el('notificationsList').append(card);
        }
        el('notificationStatus').textContent = data.total ? `${data.nao_lidas} notificação(ões) não lida(s).` : 'Nenhuma notificação neste filtro.';
        el('notificationPage').textContent = `Página ${page} de ${Math.max(1, data.totalPages)}`;
        el('previousPage').disabled = page <= 1;
        el('nextPage').disabled = page >= data.totalPages;
        el('readAll').disabled = data.nao_lidas === 0;
        window.dispatchEvent(new Event('chip-notifications-updated'));
    } catch (error) {
        el('notificationStatus').textContent = error.message || 'Não foi possível consultar as notificações.';
    } finally {
        busy = false;
        el('notificationsList').setAttribute('aria-busy', 'false');
        el('unreadOnly').disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    el('unreadOnly').addEventListener('change', () => { page = 1; loadNotifications(); });
    el('previousPage').addEventListener('click', () => { page--; loadNotifications(); });
    el('nextPage').addEventListener('click', () => { page++; loadNotifications(); });
    el('readAll').addEventListener('click', async () => {
        el('readAll').disabled = true;
        try { await lerTodasNotificacoes(); await loadNotifications(); } catch (error) { el('notificationStatus').textContent = error.message; el('readAll').disabled = false; }
    });
    await loadNotifications();
    const { profile } = await getSession().catch(() => ({ profile: null }));
    if (profile?.nivel_acesso === 2) {
        const delivery = await apiRequest('/api/notificacoes/envios').catch(() => null);
        if (delivery) {
            el('emailStatus').hidden = false;
            el('emailStatus').append(create('h2', 'Envio de e-mails'), create('p', delivery.habilitado
                ? 'Envio habilitado. As tentativas são processadas em segundo plano.'
                : 'Envio desativado nesta instalação. As notificações continuam disponíveis aqui; configure o remetente e o serviço para habilitar novos e-mails.'));
            const labels = { pendente: 'Aguardando envio', enviando: 'Em processamento', enviado: 'Enviados', falha: 'Falhas', desativado: 'Sem envio por e-mail' };
            for (const row of delivery.fila) el('emailStatus').append(create('p', `${labels[row.estado]}: ${row.total}`));
        }
    }
});
