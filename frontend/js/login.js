document.getElementById('formLogin').addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('email').value;
    const password = document.getElementById('senha').value;

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            alert('Login realizado com sucesso!');
            window.location.href = '/';
        } else {
            alert('Erro ao fazer login: ' + (data.message || 'Erro desconhecido'));
        }
    } catch (error) {
        console.error('Erro na requisição:', error);
        alert('Erro de conexão ao tentar fazer login.');
    }
});