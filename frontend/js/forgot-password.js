import { sendPasswordResetEmail } from './api.js';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('forgotPasswordForm');
    const resendButton = document.getElementById('resendForgotPassword');
    const emailInput = document.getElementById('forgotPasswordEmail');

    async function sendResetEmail() {
        const email = emailInput.value.trim();

        if (!email) {
            alert('Informe seu email para receber o link de redefinição.');
            return;
        }

        try {
            await sendPasswordResetEmail(email);
            alert('Enviamos as instruções de redefinição para o seu email.');
        } catch (error) {
            console.error('Erro ao solicitar redefinição de senha:', error);
            alert(error.message || 'Erro ao enviar email de redefinição.');
        }
    }

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        await sendResetEmail();
    });

    resendButton?.addEventListener('click', async () => {
        await sendResetEmail();
    });
});
