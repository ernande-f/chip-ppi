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
    document.getElementById('profileAvatar').textContent = initials;
    document.getElementById('headerAvatar').textContent = initials;
}

async function loadProfile() {
    const { profile } = await getProfile();

    document.getElementById('profileNameInput').value = profile.nome || '';
    document.getElementById('profileEmailInput').value = profile.email || '';
    document.getElementById('profileCpfInput').value = maskCpf(profile.cpf);
    document.getElementById('profileRole').textContent = profile.nivel_acesso_label || 'Usuario';

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

    cancelEdit.addEventListener('click', () => {
        window.location.href = '/perfil';
    });

    openPasswordModal.addEventListener('click', () => toggleModal('modal-redefinir', true));
    closePasswordModal.addEventListener('click', () => toggleModal('modal-redefinir', false));

    logoutTrigger.addEventListener('click', () => toggleModal('logoutModal', true));
    closeLogoutModal.addEventListener('click', () => toggleModal('logoutModal', false));

    document.getElementById('modal-redefinir').addEventListener('click', (event) => {
        if (event.target.id === 'modal-redefinir') {
            toggleModal('modal-redefinir', false);
        }
    });

    document.getElementById('logoutModal').addEventListener('click', (event) => {
        if (event.target.id === 'logoutModal') {
            toggleModal('logoutModal', false);
        }
    });

    confirmLogout.addEventListener('click', async () => {
        try {
            await logout();
            redirectToLogin();
        } catch (error) {
            console.error('Erro ao fazer logout:', error);
            alert(error.message || 'Nao foi possivel encerrar a sessao.');
        }
    });

    profileForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const name = document.getElementById('profileNameInput').value.trim();

        try {
            await updateProfile({ name });
            applyAvatar(name);
            alert('Perfil atualizado com sucesso.');
            window.location.href = '/perfil';
        } catch (error) {
            console.error('Erro ao atualizar perfil:', error);
            alert(error.message || 'Nao foi possivel salvar as alteracoes.');
        }
    });

    passwordForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (newPassword.length < 8) {
            alert('A nova senha precisa ter pelo menos 8 caracteres.');
            return;
        }

        if (newPassword !== confirmPassword) {
            alert('As senhas nao coincidem.');
            return;
        }

        try {
            await updatePassword(newPassword);
            passwordForm.reset();
            toggleModal('modal-redefinir', false);
            alert('Senha atualizada com sucesso.');
        } catch (error) {
            console.error('Erro ao atualizar senha:', error);
            alert(error.message || 'Nao foi possivel atualizar a senha.');
        }
    });

    fileInput.addEventListener('change', function handleAvatarPreview() {
        if (!this.files?.[0]) {
            return;
        }

        const reader = new FileReader();
        reader.onload = (loadEvent) => {
            const container = document.getElementById('avatar-container');
            container.innerHTML = `<img src="${loadEvent.target.result}" alt="Avatar" style="width:100%; height:100%; object-fit:cover;">`;
        };
        reader.readAsDataURL(this.files[0]);
    });

    try {
        await loadProfile();
    } catch (error) {
        console.error('Erro ao carregar perfil para edicao:', error);
        redirectToLogin();
    }
});
