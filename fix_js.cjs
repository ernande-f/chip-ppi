const fs = require('fs');
const jsContent = `document.addEventListener('DOMContentLoaded', function() {
    
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
            const password = document.getElementById('senha').value;
            const confirmPassword = document.getElementById('confirmar-senha').value;

            // Validação simples: verifica se as senhas coincidem
            if (password !== confirmPassword) {
                alert('As senhas não coincidem! Por favor, digite novamente.');
                return; // Para a execução aqui e não faz a requisição para a API
            }

            try {
                // Envia a requisição POST para a API
                const response = await fetch('/api/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json' // Avisa o Express que estamos enviando JSON
                    },
                    // Converte o objeto do JS para uma string JSON que será o "req.body" no backend
                    body: JSON.stringify({ name, email, cpf, password })
                });

                // Converte a resposta do servidor de volta para JSON
                const data = await response.json();

                if (response.ok && data.success) {
                    alert('Cadastro realizado com sucesso!');
                    // Redireciona para a página de login
                    window.location.href = '/login.html';
                } else {
                    alert('Erro ao cadastrar: ' + (data.message || 'Erro desconhecido'));
                }
            } catch (error) {
                console.error('Erro na requisição:', error);
                alert('Erro de conexão ao tentar fazer o cadastro.');
            }
        });
    }
});`;
fs.writeFileSync('frontend/js/cadastro.js', jsContent);
