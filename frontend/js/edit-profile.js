import {
    getInitials,
    getProfile,
    logout,
    maskCpf,
    updatePassword,
    updateProfile
} from './api.js';

function redirectToLogin() {
    window.location.href = '/login';
}

function toggleModal(modalId, show) {
    const modal = document.getElementById(modalId);
    const page = document.getElementById('page-content');

    if (show) {
        modal.style.display = 'flex';
        page.classList.add('modal-active');
        return;
    }

    modal.style.display = 'none';
    page.classList.remove('modal-active');
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

    const role = profile.nivel_acesso_label || profile.nivel_acesso;
    const roleLabel = (role === 'tecnico' || role === 'Tecnico' || role === 1) ? 'Técnico' : (profile.nivel_acesso_label || 'Usuário');

    const nameInput = document.getElementById('profileNameInput');
    const emailInput = document.getElementById('profileEmailInput');
    const cpfInput = document.getElementById('profileCpfInput');
    const roleSpan = document.getElementById('profileRole');

    if (nameInput) nameInput.value = profile.nome || '';
    if (emailInput) emailInput.value = profile.email || '';
    if (cpfInput) cpfInput.value = maskCpf(profile.cpf);
    if (roleSpan) roleSpan.textContent = roleLabel;

    applyAvatar(profile.nome);
}

document.addEventListener('DOMContentLoaded', async () => {
    const profileForm = document.getElementById('profileForm');
    const passwordForm = document.getElementById('passwordForm');
    const fileInput = document.getElementById('file-input');
    const logoutTrigger = document.getElementById('logoutTrigger');
    const confirmLogout = document.getElementById('confirmLogout');
    const cancelEdit = document.getElementById('cancelEdit');
    const openPasswordModal = document.getElementById('openPasswordModal');
    const closePasswordModal = document.getElementById('closePasswordModal');
    const closeLogoutModal = document.getElementById('closeLogoutModal');
    const selectAvatarButton = document.getElementById('selectAvatarButton');
    const passwordModal = document.getElementById('modal-redefinir');
    const logoutModal = document.getElementById('logoutModal');

    if (cancelEdit) {
        cancelEdit.addEventListener('click', () => {
            window.location.href = '/perfil';
        });
    }

    if (openPasswordModal) {
        openPasswordModal.addEventListener('click', () => toggleModal('modal-redefinir', true));
    }
    if (closePasswordModal) {
        closePasswordModal.addEventListener('click', () => toggleModal('modal-redefinir', false));
    }
    if (selectAvatarButton && fileInput) {
        selectAvatarButton.addEventListener('click', () => fileInput.click());
    }

    if (logoutTrigger) {
        logoutTrigger.addEventListener('click', () => toggleModal('logoutModal', true));
    }
    if (closeLogoutModal) {
        closeLogoutModal.addEventListener('click', () => toggleModal('logoutModal', false));
    }

    if (passwordModal) {
        passwordModal.addEventListener('click', (event) => {
            if (event.target === passwordModal) {
                toggleModal('modal-redefinir', false);
            }
        });
    }

    if (logoutModal) {
        logoutModal.addEventListener('click', (event) => {
            if (event.target === logoutModal) {
                toggleModal('logoutModal', false);
            }
        });
    }

    if (confirmLogout) {
        confirmLogout.addEventListener('click', async () => {
            try {
                await logout();
                redirectToLogin();
            } catch (error) {
                console.error('Erro ao fazer logout:', error);
                alert(error.message || 'Não foi possível encerrar a sessão.');
            }
        });
    }

    if (profileForm) {
        profileForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const name = document.getElementById('profileNameInput')?.value.trim();

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

    if (passwordForm) {
        passwordForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const newPassword = document.getElementById('newPassword')?.value;
            const confirmPassword = document.getElementById('confirmPassword')?.value;

            if (newPassword !== confirmPassword) {
                alert('As senhas não coincidem.');
                return;
            }

            try {
                await updatePassword(newPassword);
                passwordForm.reset();
                toggleModal('modal-redefinir', false);
                alert('Senha atualizada com sucesso.');
            } catch (error) {
                console.error('Erro ao atualizar senha:', error);
                alert(error.message || 'Não foi possível atualizar a senha.');
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', function handleAvatarPreview() {
            if (!this.files?.[0]) {
                return;
            }

            const reader = new FileReader();
            reader.onload = (loadEvent) => {
                const container = document.getElementById('avatar-container');
                if (!container) return;
                const image = document.createElement('img');
                image.src = loadEvent.target.result;
                image.alt = 'Avatar';
                image.style.width = '100%';
                image.style.height = '100%';
                image.style.objectFit = 'cover';
                container.replaceChildren(image);
            };
            reader.readAsDataURL(this.files[0]);
        });
    }

    try {
        await loadProfile();
    } catch (error) {
        console.error('Erro ao carregar perfil para edição:', error);
        redirectToLogin();
    }
});
