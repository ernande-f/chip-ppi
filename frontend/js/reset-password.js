import { updatePassword } from './api.js';

function getRecoveryAccessToken() {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return hashParams.get('access_token');
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('resetPasswordForm');
    const newPasswordInput = document.getElementById('new-password');
    const confirmPasswordInput = document.getElementById('confirm-password');

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();

        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        if (!newPassword) {
            alert('Informe a nova senha.');
            return;
        }

        if (newPassword !== confirmPassword) {
            alert('As senhas não coincidem.');
            return;
        }

        const recoveryToken = getRecoveryAccessToken();

        if (!recoveryToken) {
            alert('Este link de recuperação é inválido ou expirou. Solicite um novo link.');
            return;
        }

        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${recoveryToken}`
        };

        try {
            await updatePassword(newPassword, headers);
            window.history.replaceState({}, document.title, window.location.pathname);
            alert('Senha atualizada com sucesso.');
            window.location.href = '/login';
        } catch (error) {
            console.error('Erro ao redefinir senha:', error);
            alert(error.message || 'Erro ao redefinir senha.');
        }
    });
});
