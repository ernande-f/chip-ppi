import { getSession } from './api.js';

const $ = id => document.getElementById(id);
const role = level => ['Solicitante', 'Técnico', 'Administrador'][level] || 'Solicitante';
const date = value => value ? value.slice(0, 10).split('-').reverse().join('/') : '—';
let profile, page = 1, totalPages = 0, users = [], selectedId = null, selectedUser = null, detailRequest = 0, listRequest = 0;

async function request(url, options) {
    const response = await fetch(url, { credentials: 'include', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a operação.');
    return data;
}

function paragraph(text, className) {
    const p = document.createElement('p');
    p.textContent = text;
    if (className) p.className = className;
    return p;
}

function statusText(user) {
    if (!user.status_conta) return `Bloqueada manualmente${user.motivo_bloqueio ? `: ${user.motivo_bloqueio}` : ''}`;
    if (user.bloqueio_automatico_ativo) return `Bloqueada por atraso até ${date(user.bloqueio_automatico_ate)}`;
    return 'Conta liberada';
}

async function loadUsers() {
    const currentRequest = ++listRequest;
    $('usersMessage').textContent = 'Carregando usuários…';
    $('previousUsers').disabled = true;
    $('nextUsers').disabled = true;
    try {
        const data = await request(`/api/gestao/usuarios?search=${encodeURIComponent($('userQuery').value.trim())}&page=${page}`);
        if (currentRequest !== listRequest) return;
        users = data.usuarios;
        totalPages = data.totalPages;
        $('usersMessage').textContent = `${data.total} usuário(s) encontrado(s).`;
        $('usersPage').textContent = totalPages ? `${page} de ${totalPages}` : 'Nenhum resultado';
        $('previousUsers').disabled = page <= 1;
        $('nextUsers').disabled = page >= totalPages;
        $('usersList').replaceChildren(...users.map(user => {
            const li = document.createElement('li');
            li.className = 'management-user';
            li.setAttribute('aria-current', String(String(user.id_usuario) === selectedId));
            const heading = document.createElement('h2');
            heading.textContent = user.nome;
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Ver conta e pedidos';
            button.setAttribute('aria-label', `Ver conta e pedidos de ${user.nome}`);
            button.addEventListener('click', () => showUser(user.id_usuario));
            li.append(heading, paragraph(user.email, 'management-email'), paragraph(role(user.nivel_acesso)), paragraph(statusText(user)), button);
            return li;
        }));
    } catch (error) { if (currentRequest === listRequest) $('usersMessage').textContent = error.message; }
}

async function showUser(id, { focus = true } = {}) {
    const currentRequest = ++detailRequest;
    selectedId = String(id);
    selectedUser = null;
    $('editUserMessage').textContent = '';
    $('userDetail').hidden = false;
    $('userDetailTitle').textContent = 'Carregando conta…';
    $('userEdit').hidden = true;
    for (const id of ['detailEmail', 'detailStatus', 'detailPenalty', 'userHistorySummary']) $(id).textContent = '';
    $('userHistory').replaceChildren();
    try {
        const { usuario, pedidos } = await request(`/api/gestao/usuarios/${id}/pedidos`);
        if (currentRequest !== detailRequest) return;
        selectedUser = usuario;
        $('userDetailTitle').textContent = usuario.nome;
        $('detailEmail').textContent = usuario.email;
        $('detailStatus').textContent = `${role(usuario.nivel_acesso)} · ${statusText(usuario)}`;
        $('detailPenalty').textContent = usuario.bloqueio_automatico_ate ? `Penalidade por atraso: ${usuario.bloqueio_automatico_ativo ? 'vigente até' : 'encerrada em'} ${date(usuario.bloqueio_automatico_ate)}. A liberação automática ocorre nessa data.` : '';
        $('userEdit').hidden = profile.nivel_acesso !== 2;
        $('editUserName').value = usuario.nome;
        $('editUserRole').value = String(usuario.nivel_acesso);
        $('editUserRole').disabled = String(profile.id_usuario) === selectedId;
        $('editUserActive').value = String(usuario.status_conta);
        $('editUserActive').disabled = usuario.nivel_acesso === 2;
        $('editUserReason').value = '';
        $('clearUserPenalty').hidden = !usuario.bloqueio_automatico_ativo;
        $('userHistorySummary').textContent = pedidos.length ? `${pedidos.length} pedido(s). Abra um pedido para ver os itens.` : 'Este usuário ainda não realizou pedidos.';
        $('userHistory').replaceChildren(...pedidos.map(order => {
            const details = document.createElement('details');
            details.className = 'management-order';
            const summary = document.createElement('summary');
            summary.textContent = `Pedido #${order.id_pedido} · ${order.status} · ${date(order.data_pedido)}`;
            const list = document.createElement('ul');
            for (const item of order.itens || []) {
                const li = document.createElement('li');
                li.textContent = `${item.nome}: ${item.qnt_solicitada} solicitada(s), ${item.qnt_devolvida || 0} recebida(s), ${item.qnt_danificada || 0} danificada(s).`;
                list.append(li);
            }
            details.append(summary, paragraph(`Retirada: ${date(order.data_retirada)} · Devolução prevista: ${date(order.data_prevista_devolucao)} · Devolução: ${date(order.data_devolucao)}`), list);
            if (order.justificativa) details.append(paragraph(`Justificativa: ${order.justificativa}`));
            if (order.motivo_recusa) details.append(paragraph(`Motivo: ${order.motivo_recusa}`));
            return details;
        }));
        for (const [index, li] of [...$('usersList').children].entries()) li.setAttribute('aria-current', String(String(users[index].id_usuario) === selectedId));
        if (focus) $('userDetailTitle').focus();
    } catch (error) {
        if (currentRequest === detailRequest) $('userDetailTitle').textContent = error.message;
    }
}

async function saveUser(clearAutomaticPenalty = false) {
    if (!selectedUser || !$('userEdit').reportValidity()) return;
    const input = { name: $('editUserName').value.trim(), accessLevel: Number($('editUserRole').value),
        active: $('editUserActive').value === 'true', reason: $('editUserReason').value.trim(), clearAutomaticPenalty };
    if ((input.accessLevel !== selectedUser.nivel_acesso || input.active !== selectedUser.status_conta || clearAutomaticPenalty || !input.active) && input.reason.length < 3) {
        $('editUserMessage').textContent = 'Informe um motivo de 3 a 500 caracteres.';
        $('editUserReason').focus();
        return;
    }
    $('saveUser').disabled = true;
    $('clearUserPenalty').disabled = true;
    try {
        const { message } = await request(`/api/gestao/usuarios/${selectedId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
        await loadUsers();
        await showUser(selectedId, { focus: false });
        $('editUserMessage').textContent = message;
    } catch (error) { $('editUserMessage').textContent = error.message; }
    finally { $('saveUser').disabled = false; $('clearUserPenalty').disabled = false; }
}

$('userSearch').addEventListener('submit', event => { event.preventDefault(); page = 1; loadUsers(); });
$('previousUsers').addEventListener('click', () => { if (page > 1) { page--; loadUsers(); } });
$('nextUsers').addEventListener('click', () => { if (page < totalPages) { page++; loadUsers(); } });
$('userEdit').addEventListener('submit', event => { event.preventDefault(); saveUser(); });
$('clearUserPenalty').addEventListener('click', () => saveUser(true));

try {
    ({ profile } = await getSession());
    if (![1, 2].includes(profile?.nivel_acesso)) window.location.href = '/';
    else await loadUsers();
} catch (error) { $('usersMessage').textContent = error.message; }
