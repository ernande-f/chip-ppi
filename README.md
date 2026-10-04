# CHIP — Controle de Hardware e Itens de Projeto

Aplicação Express com frontend HTML/CSS/JavaScript e PostgreSQL. O catálogo é público; solicitações exigem Google institucional. Técnicos e administradores gerenciam os pedidos pelo Kanban ou pelos botões de cada pedido.

## Desenvolvimento

1. Instale Node.js 22 ou superior e PostgreSQL 16 ou superior.
2. Execute `npm install` e copie `.env.example` para `.env`.
3. Crie um banco vazio `chip`, pertencente ao usuário da aplicação, e configure `DATABASE_URL`. Defina o fuso desse banco como `America/Sao_Paulo` para os prazos do laboratório.
4. Inicialize o schema e as extensões do CHIP:

```sh
npm run db:setup
npm run dev
```

O arquivo `supabase/create_tables.sql` mantém seu caminho histórico, mas também funciona em PostgreSQL comum. A conexão do backend deve usar o proprietário das tabelas (RLS bloqueia outros papéis sem políticas); o banco não deve ser exposto ao navegador. Abra http://localhost:3000. `npm test` executa as verificações automatizadas.

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

Em produção use `https://SEU_HOST/api/auth/google/callback`, `APP_URL=https://SEU_HOST` e `NODE_ENV=production`, atrás de HTTPS. Configure a tela de consentimento e os usuários de teste enquanto o aplicativo estiver em teste. Se alunos e servidores pertencerem a organizações Workspace diferentes, um cliente interno restrito a uma delas não atende ambos: configure a audiência apropriada no Google.

Preencha `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e uma `APP_SESSION_SECRET` aleatória de pelo menos 32 caracteres. Os domínios permitidos são:

```text
GOOGLE_ALLOWED_DOMAINS=aluno.iffar.edu.br,iffarroupilha.edu.br
```

O backend verifica assinatura, emissor, audiência, expiração, nonce, e-mail verificado e domínio Workspace (`hd`). `state` e PKCE protegem o retorno OAuth. Referência: [OpenID Connect do Google](https://developers.google.com/identity/openid-connect/openid-connect).

O primeiro login cria um perfil de estudante. Perfis antigos são vinculados por e-mail institucional verificado, preservando pedidos, bloqueios e permissões; depois o vínculo usa o identificador estável `sub` do Google. O domínio de professor **não concede** acesso técnico. A administração atribui `nivel_acesso` no banco: `0` estudante/solicitante, `1` técnico, `2` administrador. As sessões anteriores precisam fazer novo login Google.

Cadastro por senha, LDAP/SIGAA e recuperação de senha deixaram de ser entradas da aplicação. Os endpoints antigos retornam 410 e as páginas antigas redirecionam para o Google. Não há envio de e-mail de cadastro ou recuperação.

## Migrar dados existentes para PostgreSQL local

Os scripts abaixo não foram configurados para executar automaticamente sobre o banco atual. Faça backup da origem e pause as gravações durante a cópia e a troca de conexão.

1. Crie um destino **vazio** e execute `npm run db:setup` com a conexão do destino. Não faça login nem cadastre itens nele antes da cópia.
2. Configure `DATABASE_URL` com o destino e `SOURCE_DATABASE_URL` com a conexão da origem. `DATABASE_URL` tem prioridade sobre a variável antiga `DATABASE_URL_POOLER`.
3. Execute:

```sh
node scripts/copy-local-database.mjs
node scripts/apply-migration.mjs database/migrations/google_login.sql
node scripts/apply-migration.mjs database/migrations/reservations.sql
```

A cópia usa uma leitura consistente da origem e uma transação no destino; preserva IDs, relações, permissões, histórico e auditoria. Recusa destino com dados e nunca modifica a origem. Os status iniciais do destino são substituídos pelos da origem. As sequências são reajustadas. Se houver e-mails duplicados ignorando maiúsculas, corrija os registros antes da migração Google; não mescle contas automaticamente.

4. Para copiar fotos antigas do Supabase Storage, mantenha temporariamente `SUPABASE_URL` da origem e execute:

```sh
node scripts/localize-product-images.mjs
```

O script troca cada URL antiga por sua imagem no banco local somente após baixar e validar a resposta. Pode ser reexecutado após uma falha; não apaga as imagens de origem. Fotos novas ficam no PostgreSQL como data URLs, limitadas a 2 MB por imagem. Isso simplifica backup e remove a dependência de Storage; para um acervo grande, mover os arquivos para armazenamento separado reduz o volume das consultas.

5. Confira contagens, catálogo, fotos, perfis e fluxo de pedidos no destino, configure Google e só então coloque esse servidor em uso. Faça backup periódico do PostgreSQL com `pg_dump`; ele também inclui as imagens locais. As ferramentas antigas de backfill de Auth e upload para Supabase são históricas e não fazem parte deste procedimento.

## Pedidos, Kanban e reservas

A solicitação separa o estoque imediatamente, inclusive enquanto pendente. A aprovação não faz uma segunda baixa. Devolução, recusa e cancelamento devolvem o estoque em transação. Cada mudança é auditada. É possível cancelar até antes da retirada; pedidos retirados precisam ser devolvidos.

O Kanban aceita apenas as transições do fluxo: Pendente → Aprovado → Em separação → Pronto para retirada → Retirado → Devolvido. Recusa exige justificativa. Abrir o cartão oferece as mesmas ações por teclado e celular.

Para agendar, preencha retirada e devolução previstas no carrinho. O período deve ter de 1 a 15 dias e não pode iniciar no passado. As datas ficam visíveis para solicitante e equipe. A retirada só pode ser confirmada a partir do início e antes do fim da reserva; atrasos na retirada não prorrogam a devolução prevista. Reservas não retiradas devem ser canceladas para liberar estoque.

Nesta versão, a reserva bloqueia os itens desde a solicitação, mesmo quando a retirada é futura. Não há reutilização automática do mesmo estoque entre períodos de reservas. Pedidos sem datas continuam usando a duração de 1 a 15 dias contada da retirada efetiva; cada pessoa pode manter até três pedidos ativos.

Avisos de prazo por e-mail ficam para uma etapa posterior: uma rotina diária que consulte devoluções previstas, com registro do envio para evitar duplicatas. OAuth autentica a pessoa, mas não fornece um serviço de envio de e-mails para o CHIP.

## Teste de ponta a ponta com Playwright

`scripts/smoke-local.mjs` usa PostgreSQL local e Playwright para criar bancos temporários, validar migrações e testar catálogo anônimo, permissões, reserva, estoque, Kanban por arraste/teclado e cópia de dados. Remove somente os bancos criados pelo teste. Requer um usuário local com permissão de criar bancos, o pacote `playwright` disponível e Chromium instalado.

```sh
TEST_DATABASE_URL=postgresql://USUARIO:SENHA@127.0.0.1:5432/postgres npm run test:local
```

Se Playwright já estiver instalado fora do projeto, informe seu `index.mjs` em `PLAYWRIGHT_MODULE`; `PLAYWRIGHT_EXECUTABLE` permite apontar para um Chromium existente. Capturas ficam na pasta `chip-smoke-artifacts` dentro do diretório temporário do sistema.
