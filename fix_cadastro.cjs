const fs = require('fs');

const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cadastro - IFFar</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    
    <style>
        /* --- Reset Básico --- */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Inter', sans-serif;
        }
        body {
            background-color: #f5f5f5;
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        .container {
            display: flex;
            width: 100%;
            height: 100vh;
            background: #fff;
        }
        /* ================================
           LADO ESQUERDO (Laranja)
           ================================ */
        .left-panel {
            flex: 1;
            background-color: #d99c3e;
            background-image: url('../assets/imagem_esquerda.png');
            background-size: cover;
            background-position: center;
            position: relative;
            padding: 50px;
            overflow: hidden;
        }
        .fundo-img {
            display: none;
        }
        .left-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 2;
            position: relative;
        }
        .left-header h2 {
            font-size: 20px;
            font-weight: 700;
            color: #000;
            letter-spacing: 0.5px;
        }
        .left-header i {
            font-size: 24px;
            color: #000;
            cursor: pointer;
        }
        .shape {
            position: absolute;
            bottom: -20px;
            left: -20px;
            width: 50%;
            height: 70%;
            background-color: #e4ae5d;
            border-top: 15px solid #ebd094;
            border-right: 15px solid #ebd094;
            clip-path: polygon(0 25%, 35% 25%, 70% 50%, 70% 100%, 0 100%);
        }
        /* ================================
           LADO DIREITO (Formulário Branco)
           ================================ */
        .right-panel {
            flex: 1;
            background-color: #ffffff;
            position: relative;
            display: flex;
            flex-direction: column;
            justify-content: center;
            padding: 50px 10%;
        }
        .logo-container {
            position: absolute;
            top: 50px;
            right: 50px;
        }
        .logo-container img {
            height: 65px;
        }
        .form-container {
            max-width: 450px;
            width: 100%;
        }
        .form-container h1 {
            font-size: 22px;
            color: #111;
            margin-bottom: 25px;
            font-weight: 700;
        }
        /* Inputs */
        .input-group {
            margin-bottom: 20px;
        }
        .input-group input {
            width: 100%;
            padding: 16px 20px;
            background-color: #f0f0f0;
            border: none;
            border-radius: 6px;
            font-size: 15px;
            color: #333;
            font-weight: 600;
            outline: none;
        }
        .input-group input::placeholder {
            color: #888;
            font-weight: 600;
        }
        /* Container para alinhar o botão e o texto "1 de 2" */
        .action-row {
            display: flex;
            align-items: center;
            gap: 15px;
            margin-top: 10px;
            margin-bottom: 20px;
        }
        .btn-submit {
            padding: 14px 45px;
            background-color: #f4bd60;
            color: #684a1e;
            border: none;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 700;
            cursor: pointer;
            transition: background-color 0.3s ease;
        }
        .btn-submit:hover {
            background-color: #e5b055;
        }
        /* Texto indicativo de passo (1 de 2) */
        .step-indicator {
            color: #d99c3e;
            font-weight: 700;
            font-size: 14px;
        }
        /* Link de login na parte inferior */
        .login-link {
            font-size: 14px;
            font-weight: 700;
            color: #333;
        }
        .login-link a {
            color: #4a3411;
            text-decoration: underline;
        }
        .login-link a:hover {
            color: #000;
        }
        /* Responsividade */
        @media (max-width: 768px) {
            .container {
                flex-direction: column;
            }
            .left-panel {
                display: none;
            }
            .right-panel {
                padding: 40px 20px;
            }
            .logo-container {
                position: static;
                margin-bottom: 40px;
                text-align: right;
            }
        }
    </style>
</head>
<body>
    <main class="container">
        <section class="left-panel">
            <header class="left-header">
                <h2>CHIP</h2>
                <i class="fa-regular fa-circle-question"></i>
            </header>
        </section>
        <section class="right-panel">
            <div class="logo-container">
                <img src="../assets/logo.iffar.png" alt="logo-iffar">
            </div>
            <div class="form-container">
                <h1>Cadastro</h1>
                <form id="formCadastro">
                    <div id="passo1">
                        <div class="input-group">
                            <input type="text" placeholder="Nome completo" id="nome">
                        </div>
                        <div class="input-group">
                            <input type="email" placeholder="Email institucional" id="email">  
                        </div>
                        <div class="input-group">
                            <input type="text" placeholder="CPF" id="cpf">
                        </div>
                        <div class="action-row">
                            <button type="button" class="btn-submit" id="btnAvancar">Avançar</button>
                            <span class="step-indicator">1 de 2</span>
                        </div>
                    </div>
                    <div id="passo2" style="display: none;">
                        <div class="input-group">
                            <input type="password" placeholder="Senha" id="senha">
                        </div>
                        <div class="input-group">
                            <input type="password" placeholder="Confirmar Senha" id="confirmar-senha">
                        </div>
                        <div class="action-row">
                            <button type="submit" class="btn-submit">Concluir</button>
                            <span class="step-indicator">2 de 2</span>
                        </div>
                    </div>
                    <div class="login-link">
                        Já tem conta? <a href="/login">Entrar</a>
                    </div>
                </form>
            </div>
        </section>
    </main>
    <script src="../js/cadastro.js"></script>
</body>
</html>`;

fs.writeFileSync('frontend/pages/cadastro.html', htmlContent);
