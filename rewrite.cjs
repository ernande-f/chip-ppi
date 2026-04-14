const fs = require('fs');

const content = fs.readFileSync('frontend/pages/cadastro.html', 'utf8');

const regex = /<form id="formCadastro">[\s\S]*?<\/form>/;

const newForm = `<form id="formCadastro">
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
                </form>`;

fs.writeFileSync('frontend/pages/cadastro.html', content.replace(regex, newForm));
