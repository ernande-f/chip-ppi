import { register } from './api.js';

// Aguarda todo o HTML carregar antes de executar o script
document.addEventListener('DOMContentLoaded', function() {
    
    // ==========================================
    // 1. LÓGICA DE TROCA DE TELAS (PASSOS 1 E 2)
    // ==========================================
    const btnAvancar = document.getElementById('btnAvancar');
    const passo1 = document.getElementById('passo1');
    const passo2 = document.getElementById('passo2');

    // Verifica se o botão existe para não dar erro
    if (btnAvancar) {
        btnAvancar.addEventListener('click', function() {
            // Esconde a parte 1 e mostra a parte 2
            passo1.style.display = 'none';
            passo2.style.display = 'block';
        });
    }

    // ==========================================
    // 2. LÓGICA DE ENVIO PARA A API
    // ==========================================
    const formCadastro = document.getElementById('formCadastro');

    // Verifica se o formulário existe na página
    if (formCadastro) {
        formCadastro.addEventListener('submit', async (event) => {
            // Evita que a página recarregue ao enviar o formulário
            event.preventDefault();

            // Captura os valores digitados no form (Atenção aos IDs correspondentes no HTML)
            const name = document.getElementById('nome').value;
            const email = document.getElementById('email').value;
            const cpf = document.getElementById('cpf').value;
            const password = document.getElementById('senha').value; // Corrigido para 'senha'
            const confirmPassword = document.getElementById('confirmar-senha').value;

            // Validação simples: verifica se as senhas coincidem
            if (password !== confirmPassword) {
                alert('As senhas não coincidem! Por favor, digite novamente.');
                return; // Para a execução aqui e não faz a requisição para a API
            }

            try {
                const data = await register({ name, email, cpf, password });

                if (data.requiresEmailConfirmation) {
                    alert('Cadastro realizado com sucesso! Confirme seu email antes de entrar.');
                } else {
                    alert('Cadastro realizado com sucesso!');
                }

                window.location.href = '/login';
            } catch (error) {
                console.error('Erro ao cadastrar:', error);
                alert(error.message || 'Erro de conexão ao tentar fazer o cadastro.');
            }
        });
    }
});
