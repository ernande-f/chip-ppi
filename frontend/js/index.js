import { getInitials, getSession } from './api.js';

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const { profile, user } = await getSession();
        const headerAvatar = document.getElementById('headerAvatar');

        if (headerAvatar) {
            const displayName = profile?.nome || user?.user_metadata?.name || user?.email || '';
            headerAvatar.textContent = getInitials(displayName);
        }
    } catch (error) {
        console.error('Erro ao validar sessão:', error);
        window.location.href = '/login';
    }
});
