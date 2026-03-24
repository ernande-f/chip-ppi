document.getElementById('formCadastro').addEventListener('submit', async (event) => {
    // Evita que a página recarregue ao enviar o formulário
    event.preventDefault();

    // Captura os valores digitados no form
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const cpf = document.getElementById('cpf').value;
    const password = document.getElementById('password').value;

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
            window.location.href = '/login';
        } else {
            alert('Erro ao cadastrar: ' + (data.message || 'Erro desconhecido'));
        }
    } catch (error) {
        console.error('Erro na requisição:', error);
        alert('Erro de conexão ao tentar fazer o cadastro.');
    }
});