import { getInitials, getSession, updateNavbarForRole, isUserTechnical, getNotificacoes } from './api.js';
import { createContrastButton } from './accessibility.js';

const globalStyle = document.createElement('link');
globalStyle.rel = 'stylesheet';
globalStyle.href = '/css/global-ui.css';
document.head.append(globalStyle);

function createNavigation(profile, tools) {
    const menu = document.createElement('details');
    menu.className = 'chip-menu';
    const summary = document.createElement('summary');
    summary.textContent = 'Menu';
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', 'Navegação do CHIP');
    const links = [['/', 'Catálogo'], ['/pedidos', 'Pedidos'], ['/notificacoes.html', 'Notificações'], ['/perfil', 'Meu perfil']];
    if (isUserTechnical(profile)) links.splice(2, 0, ['/usuarios.html', 'Usuários'], ['/relatorios.html', 'Relatórios']);
    for (const [href, label] of links) {
        const link = document.createElement('a');
        link.href = href;
        link.textContent = label;
        nav.append(link);
    }
    menu.append(summary, nav);
    tools.prepend(menu);

    const notifications = document.createElement('a');
    notifications.id = 'notificationsLink';
    notifications.href = '/notificacoes.html';
    notifications.className = 'chip-notification-link';
    notifications.setAttribute('aria-label', 'Notificações');
    const bell = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    bell.setAttribute('viewBox', '0 0 24 24');
    bell.setAttribute('fill', 'currentColor');
    bell.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 2a2 2 0 0 0-2 2v.35A6 6 0 0 0 6 10v5l-2 2v1h16v-1l-2-2v-5a6 6 0 0 0-4-5.65V4a2 2 0 0 0-2-2Zm0 20a3 3 0 0 0 2.83-2H9.17A3 3 0 0 0 12 22Z');
    bell.append(path);
    const count = document.createElement('span');
    count.className = 'chip-notification-count';
    count.hidden = true;
    notifications.append(bell, count);
    tools.prepend(notifications);
    async function refreshCount() {
        const data = await getNotificacoes({ unreadOnly: 'true' }).catch(() => null);
        if (!data) return;
        const unread = Number(data.nao_lidas) || 0;
        count.textContent = unread > 99 ? '99+' : String(unread);
        count.hidden = unread === 0;
        notifications.setAttribute('aria-label', `Notificações: ${unread} não lida(s)`);
    }
    refreshCount();
    window.addEventListener('chip-notifications-updated', refreshCount);
    window.addEventListener('focus', refreshCount);
    setInterval(() => { if (!document.hidden) refreshCount(); }, 60_000);
}

function ensureHeaderAvatarElement() {
    const profilePic = document.querySelector('.profile-pic');

    if (!profilePic) {
        return null;
    }

    let headerAvatar = document.getElementById('headerAvatar');

    if (!headerAvatar) {
        profilePic.replaceChildren();
        headerAvatar = document.createElement('span');
        headerAvatar.id = 'headerAvatar';
        profilePic.appendChild(headerAvatar);
    }

    return headerAvatar;
}

document.addEventListener('DOMContentLoaded', async () => {
    const inactiveSearch = document.querySelector('.navbar .search-bar input[readonly]');
    if (inactiveSearch) {
        const catalogLink = document.createElement('a');
        catalogLink.href = '/';
        catalogLink.className = 'nav-link-item nav-text-bold';
        catalogLink.textContent = 'Explorar catálogo';
        inactiveSearch.parentElement.replaceWith(catalogLink);
    }
    document.querySelectorAll('.navbar .icon-notification, .navbar .sino-img').forEach((icon) => icon.remove());
    document.querySelector('.navbar a[href="/perfil"]')?.setAttribute('aria-label', 'Seu perfil');
    const nav = document.querySelector('.navbar .nav-links');
    const tools = document.createElement('div');
    tools.className = 'chip-tools';
    tools.append(createContrastButton());
    nav?.append(tools);

    try {
        const { profile, user } = await getSession();
        if (!user) return;
        const headerAvatar = ensureHeaderAvatarElement();

        if (headerAvatar) {
            const displayName = profile?.nome || user?.user_metadata?.name || user?.email || '';
            headerAvatar.textContent = getInitials(displayName);
        }

        updateNavbarForRole(profile);
        if (nav) createNavigation(profile, tools);
    } catch (error) {
        console.error('Erro ao validar sessão:', error);
        window.location.href = '/login';
    }
});
