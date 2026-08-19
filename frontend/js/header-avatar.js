import { getInitials, getSession, updateNavbarForRole } from './api.js';

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
    try {
        const { profile, user } = await getSession();
        const headerAvatar = ensureHeaderAvatarElement();

        if (headerAvatar) {
            const displayName = profile?.nome || user?.user_metadata?.name || user?.email || '';
            headerAvatar.textContent = getInitials(displayName);
        }

        updateNavbarForRole(profile);
    } catch (error) {
        console.error('Erro ao validar sessão:', error);
        window.location.href = '/login';
    }
});
