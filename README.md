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

O primeiro login cria um perfil de estudante. Perfis antigos são vinculados por e-mail institucional verificado, preservando pedidos, bloqueios e permissões; depois o vínculo usa o identificador estável `sub` do Google. O domínio de professor **não concede** acesso técnico. A administração atribui `nivel_acesso` no banco: `0` estudante/solicitante, `1` técnico, `2` administrador. O guia explica como promover o primeiro administrador. As sessões anteriores precisam fazer novo login Google.

Cadastro por senha, LDAP/SIGAA e recuperação de senha deixaram de ser entradas da aplicação. Os endpoints antigos retornam 410 e as páginas antigas redirecionam para o Google. Não há envio de e-mail de cadastro ou recuperação.

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

## Pedidos, Kanban e reservas

A solicitação separa o estoque imediatamente, inclusive enquanto pendente. A aprovação não faz uma segunda baixa. Devolução, recusa e cancelamento devolvem o estoque em transação. Cada mudança é auditada. É possível cancelar até antes da retirada; pedidos retirados precisam ser devolvidos.

O Kanban aceita apenas as transições do fluxo: Pendente → Aprovado → Em separação → Pronto para retirada → Retirado → Devolvido. Recusa exige justificativa. Abrir o cartão oferece as mesmas ações por teclado e celular.

Para agendar, preencha retirada e devolução previstas no carrinho. O período deve ter de 1 a 15 dias e não pode iniciar no passado. As datas ficam visíveis para solicitante e equipe. A retirada só pode ser confirmada a partir do início e antes do fim da reserva; atrasos na retirada não prorrogam a devolução prevista. Reservas não retiradas devem ser canceladas para liberar estoque.

Nesta versão, a reserva bloqueia os itens desde a solicitação, mesmo quando a retirada é futura. Não há reutilização automática do mesmo estoque entre períodos de reservas. Pedidos sem datas continuam usando a duração de 1 a 15 dias contada da retirada efetiva; cada pessoa pode manter até três pedidos ativos.

Avisos de prazo por e-mail ficam para uma etapa posterior: uma rotina diária que consulte devoluções previstas, com registro do envio para evitar duplicatas. OAuth autentica a pessoa, mas não fornece um serviço de envio de e-mails para o CHIP.

## Teste de ponta a ponta com Playwright

`scripts/smoke-local.mjs` usa PostgreSQL local e Playwright para criar bancos temporários, validar migrações e testar catálogo anônimo, permissões, reserva, estoque, Kanban por arraste/teclado e cópia de dados. Remove somente os bancos criados pelo teste. Requer um usuário local com permissão de criar bancos, dependências de desenvolvimento instaladas por `npm ci` e Chromium instalado.

```sh
npx playwright install chromium
TEST_DATABASE_URL=postgresql://USUARIO:SENHA@127.0.0.1:5432/postgres npm run test:local
```

No PowerShell, configure `$env:TEST_DATABASE_URL` antes de `npm run test:local`. Use uma conta de teste separada da conta da aplicação. O fluxo automatizado valida a integração com sessões locais; confira também o login completo com uma conta Google real no endereço da instalação.

Se Playwright já estiver instalado fora do projeto, informe seu `index.mjs` em `PLAYWRIGHT_MODULE`; `PLAYWRIGHT_EXECUTABLE` permite apontar para um Chromium existente. Capturas ficam na pasta `chip-smoke-artifacts` dentro do diretório temporário do sistema.
