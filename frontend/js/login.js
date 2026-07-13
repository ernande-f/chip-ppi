import { institutionalLogin, login } from './api.js';

const localForm = document.getElementById('formLogin');
const institutionalForm = document.getElementById('formInstitutionalLogin');
const toggleInstitutionalButton = document.getElementById('toggleInstitutionalLogin');

function formatCpf(value) {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    return digits
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

toggleInstitutionalButton?.addEventListener('click', () => {
    const willShow = institutionalForm.hidden;
    institutionalForm.hidden = !willShow;
    toggleInstitutionalButton.setAttribute('aria-expanded', String(willShow));
    toggleInstitutionalButton.textContent = willShow
        ? 'Fechar acesso institucional'
        : 'Entrar com conta institucional';

    if (willShow) {
        document.getElementById('cpf')?.focus();
    }
});

document.getElementById('cpf')?.addEventListener('input', (event) => {
    event.target.value = formatCpf(event.target.value);
});

localForm?.addEventListener('submit', async (event) => {
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

institutionalForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const cpf = document.getElementById('cpf').value;
    const password = document.getElementById('senhaInstitucional').value;
    const type = document.getElementById('tipoInstitucional').value;

    try {
        await institutionalLogin({ cpf, password, type });
        window.location.href = '/';
    } catch (error) {
        console.error('Erro ao fazer login institucional:', error);
        alert(error.message || 'Não foi possível entrar com a conta institucional.');
    }
});
