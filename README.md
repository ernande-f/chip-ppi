# CHIP — Controle de Hardware e Itens de Projeto

Aplicação Express com frontend HTML/CSS/JavaScript e PostgreSQL instalado na própria máquina ou no servidor da instituição. Perfis, permissões, pedidos, catálogo e fotos ficam nesse banco; as sessões são assinadas pelo próprio backend. O catálogo é público e o login usa exclusivamente Google OAuth institucional, sem Supabase Auth, Supabase Storage ou API Supabase em execução.

Google continua sendo um serviço externo: entrar exige acesso à internet. Os dados da aplicação são mantidos pelo CHIP. Instalar um PostgreSQL novo cria um banco independente; copiar os dados do banco antigo é uma etapa separada.

## Instalação nativa

O [guia de instalação](docs/installation.md) explica criação do banco no macOS, Linux e Windows, Google OAuth, execução como serviço, HTTPS, backups e restauração.

1. Instale Node.js 22 ou superior e PostgreSQL 16 ou superior.
2. Execute `npm ci` e copie `.env.example` para `.env` (`Copy-Item .env.example .env` no PowerShell).
3. Crie um banco vazio `chip`, pertencente ao usuário da aplicação, e configure `DATABASE_URL`. Defina o fuso desse banco como `America/Sao_Paulo` para os prazos do laboratório.
4. Configure `APP_URL`, Google e uma chave de sessão aleatória conforme a seção abaixo. Inicialize e confira o schema antes de iniciar:

```sh
npm run db:setup
npm run db:check
npm run doctor
npm start
```

O schema fica em `database/schema.sql`, com evoluções em `database/migrations`. A conexão do backend deve usar o proprietário das tabelas; o banco não deve ser exposto ao navegador. O setup pode ser reaplicado e não importa dados de outra instalação. O backend usa `DATABASE_TIMEZONE=America/Sao_Paulo` para as datas do laboratório.

Abra http://localhost:3000. `GET /api/health` verifica banco e schema sem divulgar credenciais. Para desenvolvimento com recarga automática, use `npm run dev`. `npm test` executa as verificações automatizadas.

### Ambiente local separado

Para manter a configuração existente em `.env`, copie `.env.example` para `.env.local` e configure ali o banco local, a chave de sessão e o Google. Esse arquivo é ignorado pelo Git. Os comandos abaixo priorizam `.env.local`:

```sh
npm run db:setup:local
npm run dev:local
```

No macOS com Homebrew, instale PostgreSQL com `brew install postgresql@16` e inicie com `brew services start postgresql@16`. Crie o usuário e banco indicados em `DATABASE_URL` antes de executar o setup. O setup cria a estrutura; a cópia dos dados existentes é uma etapa separada, descrita abaixo.

## Google institucional

Configure um cliente OAuth do tipo **Aplicativo da Web** no Google Cloud e cadastre como URI de retorno:

```text
http://localhost:3000/api/auth/google/callback
```

Em produção use `https://SEU_HOST/api/auth/google/callback`, `APP_URL=https://SEU_HOST` e `NODE_ENV=production`, atrás de HTTPS. Google exige domínio válido e HTTPS fora de localhost; um endereço como `http://192.168.0.10:3000` não serve como retorno OAuth. Cada URI precisa coincidir exatamente com a configuração do cliente. [Regras do Google](https://developers.google.com/identity/protocols/oauth2/web-server#redirect-uri-validation).

Configure a tela de consentimento e os usuários de teste enquanto o aplicativo estiver em teste. Se alunos e servidores pertencerem a organizações Workspace diferentes, um cliente interno restrito a uma delas não atende ambos: configure a audiência apropriada no Google.

Preencha `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e uma `APP_SESSION_SECRET` aleatória de pelo menos 32 caracteres.

Gere a chave com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Use uma chave própria por instalação e preserve-a após reinícios e atualizações. A lista de domínios é configurável:

```text
GOOGLE_ALLOWED_DOMAINS=aluno.iffar.edu.br,iffarroupilha.edu.br
```

O backend verifica assinatura, emissor, audiência, expiração, nonce, e-mail verificado e domínio Workspace (`hd`). `state` e PKCE protegem o retorno OAuth. Referência: [OpenID Connect do Google](https://developers.google.com/identity/openid-connect/openid-connect).

As chamadas ao Google têm limite de 20 segundos por etapa. As chaves públicas são reutilizadas pelo prazo informado pelo Google, com nova consulta quando expiram ou aparece um identificador de chave desconhecido. Falhas de conexão mostram uma mensagem para tentar novamente; o terminal registra a etapa (`token`, `certs`, `perfil` ou `sessao`), o tipo/código do erro e a duração, sem registrar credenciais ou tokens. Se houver `TimeoutError` ou `ENOTFOUND`, confira a conexão e o DNS do servidor para `oauth2.googleapis.com` e `www.googleapis.com`. O código de autorização não é reenviado automaticamente.

O primeiro login cria um perfil de estudante. Perfis antigos são vinculados por e-mail institucional verificado, preservando pedidos, bloqueios e permissões; depois o vínculo usa o identificador estável `sub` do Google. O domínio de professor **não concede** acesso técnico. A administração atribui `nivel_acesso` no banco: `0` estudante/solicitante, `1` técnico, `2` administrador. O guia explica como promover o primeiro administrador. As sessões anteriores precisam fazer novo login Google.

O limite padrão de autenticação é de 100 inícios de login por IP a cada 15 minutos, para atender uma turma na mesma rede. O retorno do Google não consome esse limite; permanece protegido pelo limite global da API. `AUTH_RATE_LIMIT_MAX` pode ajustar os inícios, sem desativar a proteção. Instalações com o valor antigo explícito de 20 precisam atualizar essa configuração. Nomes de perfil devem ser textos de 3 a 60 caracteres, após remover espaços externos.

O logout encerra todas as sessões da conta, inclusive cópias do token. Atualizações devem executar `npm run db:setup` para aplicar a migração de versão de sessão; sessões anteriores a essa migração exigem novo login. As respostas de perfil retornam somente os campos necessários e não devem ser armazenadas em cache.

Cadastro por senha, LDAP/SIGAA e recuperação de senha deixaram de ser entradas da aplicação. Os endpoints antigos retornam 410 e as páginas antigas redirecionam para o Google. Não há envio de e-mail de cadastro ou recuperação.

## Dados do perfil

O CHIP não utiliza CPF: o campo foi removido das telas, APIs e schema por decisão de 22/10/2026. `npm run db:setup` aplica `remove_cpf.sql`, que exclui a coluna e seus valores existentes, além de remover campos com esse nome dos objetos e arrays JSON de auditoria. A cópia de instalações antigas descarta o campo e esses registros estruturados antes de inseri-los no destino. Nome, e-mail institucional, permissões e histórico de pedidos são preservados. Backups externos anteriores não são regravados; ao restaurar uma versão antiga, reaplique as migrações antes de iniciar o sistema.

## Migrar dados existentes para PostgreSQL local

Os scripts abaixo não foram configurados para executar automaticamente sobre o banco atual. Faça backup da origem e pause as gravações durante a cópia e a troca de conexão.

1. Crie um destino **vazio** e execute `npm run db:setup` com a conexão do destino. Não faça login nem cadastre itens nele antes da cópia.
2. Configure `DATABASE_URL` com o destino e `SOURCE_DATABASE_URL` com a conexão da origem. A origem é acessada diretamente como PostgreSQL, sem API de Auth.
3. Execute:

```sh
node scripts/copy-local-database.mjs
npm run db:setup
```

A cópia usa uma leitura consistente da origem e uma transação no destino; preserva IDs, relações, permissões, histórico e auditoria. Recusa destino com dados e nunca modifica a origem. Os status iniciais do destino são substituídos pelos da origem. As sequências são reajustadas. Se houver e-mails duplicados ignorando maiúsculas, corrija os registros antes da migração Google; não mescle contas automaticamente.

4. Para copiar fotos antigas do Supabase Storage, mantenha temporariamente `SUPABASE_URL` da origem e execute:

```sh
node scripts/localize-product-images.mjs
```

O script troca cada URL antiga por sua imagem no banco local somente após baixar e validar a resposta. Pode ser reexecutado após uma falha e não apaga as imagens de origem. `SUPABASE_URL` é exclusiva da migração e deve ser removida após concluí-la. Fotos novas ficam no PostgreSQL como data URLs, limitadas a 2 MB por imagem; o backup do banco inclui essas imagens.

5. Confira contagens, catálogo, fotos, perfis e fluxo de pedidos. Execute `npm run db:check` e `npm run doctor`, configure Google e coloque o destino em uso. Remova `SOURCE_DATABASE_URL` e as variáveis do serviço antigo após a conferência.

O [guia de instalação](docs/installation.md#backup-e-restauração) inclui backup e recuperação do banco. Mantenha uma cópia fora do disco do servidor.

## Pedidos, Kanban e prazos

A solicitação separa o estoque imediatamente, inclusive enquanto pendente. A aprovação não faz uma segunda baixa. Devolução, recusa, cancelamento pelo solicitante e expiração automática devolvem o estoque em transação. Cada mudança é auditada. É possível cancelar até antes da retirada; pedidos retirados precisam ser devolvidos.

A equipe confere cada devolução: informa as unidades recebidas agora, as danificadas dentre elas e uma observação opcional. Apenas as unidades recebidas em boas condições voltam ao estoque. Quantidades recebidas e danificadas são acumuladas; enquanto faltarem unidades, o pedido permanece Retirado. Quando todas forem recebidas, passa a Devolvido. Cada recebimento registra auditoria e pode ser consultado pela equipe e pelo solicitante. A conferência envia o saldo anterior (`expectedReturned`), validado sob trava para impedir reenvio ou gravação de uma tela desatualizada. Itens arquivados permanecem ocultos mesmo quando recebem estoque de uma devolução. Remover um item do catálogo sempre o arquiva e preserva dados, categorias, fotos e relações.

Alterações de carrinho e finalização usam a mesma trava por usuário. Uma alteração concorrente termina antes da leitura do checkout ou recebe o resultado atualizado depois dele, sem desaparecer silenciosamente. O pedido também exige a versão do termo exibida na página (`termsVersion`); versões antigas ou ausentes exigem recarregar, ler e aceitar novamente.

O Kanban aceita apenas as transições do fluxo: Pendente → Aprovado → Em separação → Pronto para retirada → Retirado → Devolvido. Recusa exige justificativa. Abrir o cartão oferece as mesmas ações por teclado e celular. Expirado é um estado terminal automático, sem ação manual de expiração.

As cinco etapas em andamento ficam no quadro principal. Devolvidos, negados, cancelados e expirados ficam no histórico expansível, com busca, filtro de situação e período da solicitação (hoje, 7, 30, 90 dias ou todo o período). O histórico mostra 12 pedidos por vez e permite Ver mais até consultar todos. Os filtros de data e situação não ocultam pedidos ativos.

O solicitante escolhe apenas a duração do empréstimo, de 1 a 15 dias. O agendamento de retirada e devolução futuras foi removido. O prazo de retirada é a data de aprovação mais 10 dias corridos, incluindo a data limite, no fuso do laboratório. Separar os itens ou marcar Pronto para retirada não reinicia o prazo. A duração do empréstimo só começa na retirada efetiva; antes dela, não existe prazo de devolução em andamento.

Após a data limite, pedidos Aprovados, Em separação ou Prontos para retirada que ainda não foram retirados passam a Expirado e liberam o estoque uma única vez. A verificação ocorre a cada minuto enquanto o servidor está ativo, na inicialização e antes das operações de pedidos. A validação no servidor impede a retirada fora do prazo. Pedidos Pendentes e já Retirados não expiram por essa regra. Pedidos expirados aparecem no histórico e deixam de contar no limite de três ativos.

Aplique `npm run db:setup:local` (ou `npm run db:setup` na instalação configurada). A migração `pickup_deadline.sql` mantém as antigas datas de agendamento como histórico e registra a data de aprovação. Pedidos já aprovados sem essa data recebem o prazo de dez dias a partir da atualização; não são expirados imediatamente por falta de informação histórica. A expiração registra auditoria como ação do sistema, sem atribuí-la a uma pessoa. `return_conditions.sql` garante o campo e a validação das quantidades danificadas, preservando os dados existentes. O termo de responsabilidade passa à versão 3, com conferência de devoluções parciais e danos.

As notificações internas registram aprovação/negativa, prontidão, recebimentos, decisões de renovação e alterações de acesso. A equipe também recebe solicitações de renovação. Lembretes de devolução são verificados a cada minuto para os prazos que terminam em dois dias ou um dia, considerando renovações aprovadas. Chaves por evento impedem duplicação; uma renovação ou devolução concorrente é revalidada antes de gravar o aviso. Cada pessoa acessa e marca apenas suas próprias notificações.

O envio por e-mail usa uma fila persistente e a API Resend, fora da transação de pedidos. Fica desativado por padrão: notificações internas continuam funcionando. Para enviar **novos eventos**, configure `RESEND_API_KEY`, `EMAIL_FROM` com um endereço de domínio verificado e `NOTIFICATION_EMAIL_ENABLED=true`; reinicie o serviço. Eventos gerados enquanto o envio estava desativado não são disparados retroativamente. O worker usa timeout, reserva de trabalho, até cinco tentativas, chave idempotente e janela de 20 horas. O administrador consulta o estado da fila em Notificações. Referência: [API de envio](https://resend.com/docs/api-reference/emails/send-email) e [idempotência do Resend](https://resend.com/docs/dashboard/emails/idempotency-keys). Nenhum e-mail real foi enviado na validação local.

## Renovação, usuários e relatórios

O solicitante pode pedir renovação de um pedido Retirado com justificativa e nova data futura, no máximo 15 dias além do prazo atual. Apenas uma solicitação fica pendente por vez e cada pedido aceita até duas renovações aprovadas. A equipe aprova ou nega pelo cartão do pedido; negativa exige motivo. O prazo permanece válido até a aprovação, sem alterar os dez dias para retirada. Devolução completa encerra solicitações ainda pendentes.

“Pedir novamente” adiciona itens de um pedido próprio ao carrinho existente até a quantidade disponível. Itens sem estoque ou arquivados e quantidades reduzidas são informados ao solicitante. Não cria um pedido, não renova o aceite do termo e não reserva estoque antes do novo checkout.

O Menu do cabeçalho leva a **Usuários**, **Relatórios** e **Notificações**, conforme o perfil. Técnicos e administradores pesquisam usuários e consultam o histórico completo. Apenas administradores alteram nome, nível e bloqueio, com motivo e auditoria. Não é permitido bloquear outro administrador nem retirar o próprio acesso administrativo; alterações sensíveis revogam as sessões da conta.

Ao registrar a devolução completa atrasada, aplica-se um dia de bloqueio para cada dia de atraso em relação ao prazo efetivo, incluindo renovações. A penalidade é registrada uma única vez por pedido e acumula depois de outra penalidade vigente; a liberação ocorre automaticamente na data limite, pelo calendário do banco. Bloqueio manual é separado e não expira por essa regra. Um administrador pode liberar uma penalidade com justificativa, mantendo o histórico; administradores não recebem bloqueio automático. Danos são registrados, mas não geram penalidade automática de duração não definida no documento.

Relatórios mostram os itens que chegaram a **100% do estoque emprestado durante o período**, os itens do acervo atual sem retirada e os rankings dos itens mais e menos emprestados, pela quantidade de unidades efetivamente retiradas. Itens com zero retiradas permanecem na lista sem empréstimos. As estatísticas de utilização contam pela data da retirada, inclusive pedidos solicitados antes do período, e independem do filtro de situação. Reservas, cancelamentos, negativas e estoque vazio sem empréstimo não significam 100% emprestado. O histórico de estoque começa com a migração `inventory_usage.sql`: o estado inicial não comprova chegada a 100% e não é contado; movimentos anteriores não podem ser reconstruídos. Cada entrada nesse estado é contada uma vez, mesmo com devoluções parciais ou várias leituras seguidas. O histórico preserva os itens arquivados; a lista sem empréstimo usa o acervo atual não arquivado.

Os detalhes dos pedidos continuam filtrados pela data de solicitação e situação atual, com itens mais solicitados, usuários mais ativos, unidades recebidas/danificadas, taxa de danos e tempo médio dos empréstimos concluídos. Exportação é **CSV compatível com Excel**, com proteção contra fórmulas em campos textuais e os novos indicadores; o botão de impressão permite salvar em PDF. Não há exportação XLSX nativa.

O **Menu** do cabeçalho reúne navegação e **Alto contraste**, com preferência persistente e suporte à preferência de contraste do sistema. Em telas menores, logo, notificações, Menu e perfil ficam em uma linha e a busca ocupa a seguinte. O catálogo usa cartões que se ajustam à largura e um rodapé compartilhado que empilha as informações no celular. Os novos fluxos foram verificados por teclado e em larguras de 320, 390 e 1280 pixels; ainda precisam de homologação em aparelho real e leitor de tela.

O [estado do sistema e plano de conclusão](docs/estado-do-sistema.md) cruza a implementação com o documento oficial v5 e o cronograma. Mobile e acessibilidade, incluindo alto contraste e baixa visão, são requisitos permanentes registrados em `AGENTS.md`.

Para visualizar o quadro com exemplos locais, execute `node scripts/seed-demo-orders.mjs`. O script cria cinco pedidos identificados como DEMO, um em cada etapa ativa, com perfis sem login e um produto fictício próprio. Recusa produção/banco remoto e não duplica uma demonstração existente. Os registros permanecem no banco local para experimentar o fluxo de devolução, sem consumir o estoque dos produtos anteriores.

## Teste de ponta a ponta com Playwright

`scripts/smoke-local.mjs` usa PostgreSQL local e Playwright para criar bancos temporários, validar migrações e testar catálogo anônimo, permissões, retirada em dez dias, expiração, estoque, Kanban por arraste/teclado e cópia de dados. Remove somente os bancos criados pelo teste. Requer um usuário local com permissão de criar bancos, dependências de desenvolvimento instaladas por `npm ci` e Chromium instalado.

```sh
npx playwright install chromium
TEST_DATABASE_URL=postgresql://USUARIO:SENHA@127.0.0.1:5432/postgres npm run test:local
TEST_DATABASE_URL=postgresql://USUARIO:SENHA@127.0.0.1:5432/postgres npm run test:orders
npm run test:ui
npm run test:catalog:ui
TEST_DATABASE_URL=postgresql://USUARIO:SENHA@127.0.0.1:5432/postgres npm run test:loans
TEST_DATABASE_URL=postgresql://USUARIO:SENHA@127.0.0.1:5432/postgres npm run test:accounts
TEST_DATABASE_URL=postgresql://USUARIO:SENHA@127.0.0.1:5432/postgres npm run test:reports
TEST_DATABASE_URL=postgresql://USUARIO:SENHA@127.0.0.1:5432/postgres npm run test:notifications
TEST_DATABASE_URL=postgresql://USUARIO:SENHA@127.0.0.1:5432/postgres npm run test:features
npm run test:loans:ui
npm run test:accounts:ui
```

No PowerShell, configure `$env:TEST_DATABASE_URL` antes de `npm run test:local`. Use uma conta de teste separada da conta da aplicação. O fluxo automatizado valida a integração com sessões locais, devoluções parciais/danos e proteção contra reenvio. `test:ui` verifica os componentes em navegador com dados simulados, sem banco. Confira também o login completo com uma conta Google real no endereço da instalação.

Se Playwright já estiver instalado fora do projeto, informe seu `index.mjs` em `PLAYWRIGHT_MODULE`; `PLAYWRIGHT_EXECUTABLE` permite apontar para um Chromium existente. Capturas ficam na pasta `chip-smoke-artifacts` dentro do diretório temporário do sistema.
