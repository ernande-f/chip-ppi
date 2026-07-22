# CHIP-PPI — Problemas e melhorias

Documento gerado a partir da auditoria do código, banco, telas, dependências e requisitos oficiais do projeto.

## Resultado das validações

- `npm test`: 2 testes passaram.
- Checagem de sintaxe dos arquivos JavaScript: passou.
- Cobertura experimental dos testes: aproximadamente 44% das linhas.
- `npm audit`: 1 vulnerabilidade de baixa severidade em `body-parser@1.20.5`.
- Não existem scripts de lint, build, CI ou testes de integração configurados.

## Prioridade alta

### 1. Usuários bloqueados continuam acessando o sistema

O login por e-mail não verifica `status_conta`. Além disso, o middleware valida apenas a assinatura do JWT e não consulta o estado atual da conta. Um usuário bloqueado pode continuar usando uma sessão válida por até 48 horas.

- Arquivos: `backend/routes/api.js`, `backend/middleware/authSession.js`
- Impacto: invalida o bloqueio de usuários e o requisito RF30.
- Melhoria: validar `status_conta` no login e em todas as sessões; implementar revogação/versão de sessão.

### 2. Cadastro pode associar perfis existentes antes da confirmação do e-mail

Após o cadastro, o sistema procura um perfil pelo e-mail e pode associar o novo `auth_user_id` antes da confirmação. A resposta também devolve o perfil, incluindo CPF.

- Arquivos: `backend/routes/api.js`, `backend/services/userProfile.js`
- Impacto: vínculo incorreto, possível negação de serviço e exposição de dados pessoais.
- Melhoria: confirmar o e-mail antes de vincular perfis; não retornar CPF no cadastro; exigir validação explícita para vinculação.

### 3. Fluxo de pedidos e empréstimos não está implementado

Não há API ou lógica para:

- carrinho e gerenciamento de itens;
- finalização do pedido;
- aceite do termo de responsabilidade;
- reserva e atualização de estoque;
- aprovação ou negação com justificativa;
- separação, retirada e devolução;
- cancelamento;
- renovação de prazo;
- pedir novamente;
- limite de pedidos ativos;
- cálculo automático de datas;
- bloqueio automático por atraso.

As páginas de pedidos exibem dados fixos de exemplo.

- Arquivos: `frontend/pages/pedidos.html`, `frontend/pages/seus-pedidos.html`
- Impacto: principais funcionalidades do sistema não funcionam em produção.
- Melhoria: criar modelo de domínio, endpoints protegidos, transações de estoque e telas integradas ao banco.

### 4. RLS incompleto no Supabase

RLS e políticas foram configurados apenas para `usuario`. As tabelas de produtos, pedidos, itens, notificações, logs e listas não têm políticas próprias.

- Arquivos: `supabase/create_tables.sql`, `supabase/migrations/20260422_000001_migrate_auth_users.sql`
- Impacto: possível acesso direto indevido aos dados via API REST do Supabase.
- Melhoria: habilitar RLS em todas as tabelas e criar políticas mínimas por usuário, técnico e administrador; testar tentativas de bypass.

### 5. CSP do Helmet bloqueia scripts inline

`helmet()` usa CSP com `script-src 'self'`, mas várias páginas dependem de `<script>` inline. Isso afeta pedidos, perfil técnico, pedidos do estudante e outras telas.

- Arquivo: `backend/server.js`
- Exemplos: `frontend/pages/pedidos.html`, `frontend/pages/seus-pedidos.html`, `frontend/pages/editar-perfil-tec.html`
- Melhoria: mover scripts para arquivos externos ou usar nonce/hash por requisição; não desabilitar CSP globalmente.

## Prioridade média

### 6. Perfil técnico é apenas um protótipo

A tela contém nome, e-mail e CPF fixos. O formulário não salva nome e a redefinição de senha apenas fecha o modal. A própria rota possui comentário indicando que a tela está bugada.

- Arquivos: `backend/routes/pages.js`, `frontend/pages/editar-perfil-tec.html`
- Melhoria: reutilizar a implementação real de `editar-perfil.html`, carregar dados pela API e persistir alterações.

### 7. Gestão administrativa não existe

Não há telas ou endpoints para:

- pesquisar usuários;
- editar perfis de terceiros;
- alterar níveis de acesso;
- bloquear e desbloquear contas;
- visualizar histórico de qualquer usuário;
- visualizar histórico geral;
- impedir que um administrador bloqueie outro administrador.

### 8. Histórico de pedidos é incompleto

A API retorna somente os cinco pedidos mais recentes, enquanto o requisito prevê histórico completo. A página de pedidos também usa exemplos fixos.

- Arquivo: `backend/services/userProfile.js`
- Melhoria: criar endpoint paginado de histórico e tela baseada em dados reais.

### 9. Validação de e-mail e CPF insuficiente

O backend não valida domínio institucional nem CPF por algoritmo de dígito verificador. O CPF apenas é normalizado e armazenado.

- Arquivos: `backend/routes/api.js`, `backend/services/userProfile.js`
- Melhoria: validar domínio permitido, CPF válido e mensagens consistentes antes de chamar o Supabase ou banco.

### 10. Política de senha não atende aos requisitos

O código exige apenas oito caracteres na alteração de senha. Não aplica limite máximo, exigência de número, caractere especial ou restrições de caracteres previstas no documento.

- Arquivos: `backend/routes/api.js`, `frontend/js/edit-profile.js`, `frontend/js/reset-password.js`
- Melhoria: centralizar a política no backend e reutilizá-la no frontend.

### 11. Possível XSS em dados de pedidos

`profile.js` insere status, motivo de recusa e outros valores diretamente com `innerHTML`.

- Arquivo: `frontend/js/profile.js`
- Melhoria: usar `textContent` e criação de nós DOM; sanitizar valores quando HTML for realmente necessário.

### 12. Upload de imagens diverge dos requisitos

O sistema aceita GIF e URLs HTTP/HTTPS remotas, armazena Base64 bruto no banco, não redimensiona imagens e não converte para WebP.

- Arquivo: `backend/services/productService.js`
- Melhoria: aceitar somente formatos definidos, validar conteúdo real, redimensionar/comprimir e armazenar em Storage.

### 13. Integridade do catálogo depende apenas da aplicação

Não há `CHECK` no banco para quantidades não negativas nem unicidade case-insensitive para nomes de produtos e categorias. A verificação de duplicidade sofre condição de corrida.

- Arquivos: `supabase/create_tables.sql`, `backend/services/productService.js`
- Melhoria: adicionar constraints e índices únicos; tratar conflitos de banco com respostas 409.

### 14. Proteção CSRF usa comparação frágil

As origens permitidas são verificadas com `startsWith`, o que aceita hosts que apenas começam com o domínio esperado.

- Arquivo: `backend/server.js`
- Melhoria: comparar origem com `URL.origin` exato e configurar lista explícita de origens.

### 15. Redirecionamento HTTPS confia diretamente em cabeçalho enviado pelo cliente

O código usa `x-forwarded-proto` sem configuração explícita de proxy confiável.

- Arquivo: `backend/server.js`
- Melhoria: configurar `app.set('trust proxy', ...)` de acordo com a infraestrutura e validar o proxy real.

### 16. Recuperação de senha depende do cabeçalho `Host`

Quando `APP_URL` não está definido, a URL do e-mail é construída com `req.get('host')`.

- Arquivo: `backend/routes/api.js`
- Impacto: links incorretos ou risco de host-header injection.
- Melhoria: exigir `APP_URL` em produção e rejeitar hosts não cadastrados.

### 17. Chaves criptográficas podem ser reutilizadas

O segredo da sessão faz fallback para `ACCESS_TOKEN` ou `CRYPTO_KEY`, misturando finalidades diferentes.

- Arquivo: `backend/services/sessionAuth.js`
- Melhoria: exigir `APP_SESSION_SECRET` independente, com tamanho mínimo e validação no startup.

### 18. Logout GET desnecessário

Existe uma rota `GET /logout` além do `POST /api/logout`. A rota GET pode encerrar sessões por navegação involuntária.

- Arquivo: `backend/server.js`
- Melhoria: remover a rota GET e manter logout somente via POST.

### 19. Endpoint de teste de banco não testa o banco

`/api/test-db` sempre responde sucesso sem executar uma consulta.

- Arquivo: `backend/routes/api.js`
- Melhoria: executar `SELECT 1`, proteger o endpoint ou substituí-lo por health checks internos.

## Prioridade baixa e manutenção

### 20. Imagens referenciadas não existem

As páginas referenciam os arquivos abaixo, mas eles não estão em `frontend/assets`:

- `arduino.png`;
- `resistores.png`;
- `exemplo.png`.

### 21. Vulnerabilidade em dependência

`npm audit` encontrou uma vulnerabilidade de baixa severidade em `body-parser@1.20.5`, dependência transitiva do Express.

- Melhoria: atualizar dependências com `npm audit fix`, revisar o lockfile e repetir a auditoria.

### 22. Ausência de lint, build, CI e testes de integração

O projeto possui somente `start`, `dev` e `test`. As rotas, autenticação, banco, RLS e telas não têm testes automatizados.

- Melhoria: adicionar ESLint, testes de API com banco de teste, testes de autorização, testes de RLS e pipeline CI.

### 23. Colunas legadas de senha permanecem no banco

As colunas `senha` e `tmp_senha` continuam no esquema, embora o sistema use Supabase Auth.

- Arquivo: `supabase/create_tables.sql`
- Melhoria: remover dados legados com migração segura e eliminar campos que possam induzir armazenamento de senha.

### 24. Arquivos grandes e log versionado

O repositório contém PDFs grandes, uma imagem de aproximadamente 11 MB e `server.log` versionado.

- Melhoria: remover logs do controle de versão, usar Git LFS ou armazenamento externo para arquivos grandes e otimizar assets.

## Requisitos do documento oficial ainda não atendidos

Conforme o documento oficial de requisitos, permanecem pendentes ou não comprovados:

- notificações e envio de e-mails;
- processamento assíncrono em fila;
- logs de auditoria com IP e dados anteriores/posteriores;
- relatórios e exportação para Excel/PDF;
- reserva automática de estoque;
- atualização automática após devolução;
- controle de até três pedidos ativos;
- limite de duas renovações;
- prazo máximo de empréstimo;
- bloqueio automático por atraso;
- anonimização LGPD;
- retenção de logs por cinco anos;
- soft delete de registros críticos;
- otimização e redimensionamento de imagens;
- validação de desempenho para 50 usuários simultâneos;
- compatibilidade validada nos navegadores previstos.

