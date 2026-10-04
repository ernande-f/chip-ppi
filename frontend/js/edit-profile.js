import {
    getInitials,
    getProfile,
    isUserTechnical,
    maskCpf,
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
    const cpfInput = document.getElementById('profileCpfInput');
    const roleSpan = document.getElementById('profileRole');

    if (nameInput) nameInput.value = profile.nome || '';
    if (emailInput) emailInput.value = profile.email || '';
    if (cpfInput) cpfInput.value = maskCpf(profile.cpf);
    if (roleSpan) roleSpan.textContent = roleLabel;

    applyAvatar(profile.nome);
    updateNavbarForRole(profile);
}

document.addEventListener('DOMContentLoaded', async () => {
    const profileForm = document.getElementById('profileForm');
    const fileInput = document.getElementById('file-input');
    const cancelEdit = document.getElementById('cancelEdit');
    const selectAvatarButton = document.getElementById('selectAvatarButton');

    if (cancelEdit) {
        cancelEdit.addEventListener('click', () => {
            window.location.href = '/perfil';
        });
    }

    if (selectAvatarButton && fileInput) {
        selectAvatarButton.addEventListener('click', () => fileInput.click());
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
