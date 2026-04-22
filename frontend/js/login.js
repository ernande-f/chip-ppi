import { login } from './api.js';

document.getElementById('formLogin').addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('senha').value;

    try {
        await login({ email, password });
        window.location.href = '/';
    } catch (error) {
        console.error('Erro ao fazer login:', error);
        alert(error.message || 'Erro de conexão ao tentar fazer login.');
    }
});
