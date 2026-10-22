import {
    getInitials,
    getProfile,
    isUserTechnical,
    updateNavbarForRole,
    updateProfile
} from './api.js';

function redirectToLogin() {
    window.location.href = '/login';
}

function applyAvatar(name) {
    const initials = getInitials(name);
    const profileAvatar = document.getElementById('profileAvatar');
    const headerAvatar = document.getElementById('headerAvatar');

    if (profileAvatar) {
        profileAvatar.textContent = initials;
    }
    if (headerAvatar) {
        headerAvatar.textContent = initials;
    }
}

async function loadProfile() {
    const { profile } = await getProfile();
    const isTechnical = isUserTechnical(profile);

    const roleLabel = isTechnical
        ? (profile.nivel_acesso === 2 || String(profile.nivel_acesso).toLowerCase().includes('adm') ? 'Administrador' : (profile.nivel_acesso_label || 'Técnico'))
        : (profile.nivel_acesso_label || 'Usuário');

    const nameInput = document.getElementById('profileNameInput');
    const emailInput = document.getElementById('profileEmailInput');
    const roleSpan = document.getElementById('profileRole');

    if (nameInput) nameInput.value = profile.nome || '';
    if (emailInput) emailInput.value = profile.email || '';
    if (roleSpan) roleSpan.textContent = roleLabel;

    applyAvatar(profile.nome);
    updateNavbarForRole(profile);
}

document.addEventListener('DOMContentLoaded', async () => {
    const profileForm = document.getElementById('profileForm');
    const cancelEdit = document.getElementById('cancelEdit');

    if (cancelEdit) {
        cancelEdit.addEventListener('click', () => {
            window.location.href = '/perfil';
        });
    }

    if (profileForm) {
        profileForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const name = document.getElementById('profileNameInput')?.value.trim();
            if (!name || name.length < 3 || name.length > 60) {
                alert('Informe um nome válido entre 3 e 60 caracteres.');
                return;
            }

            try {
                await updateProfile({ name });
                applyAvatar(name);
                alert('Perfil atualizado com sucesso.');
                window.location.href = '/perfil';
            } catch (error) {
                console.error('Erro ao atualizar perfil:', error);
                alert(error.message || 'Não foi possível salvar as alterações.');
            }
        });
    }

    try {
        await loadProfile();
    } catch (error) {
        console.error('Erro ao carregar perfil para edição:', error);
        redirectToLogin();
    }
});
