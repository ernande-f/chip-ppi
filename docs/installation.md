# Instalação nativa do CHIP

O CHIP roda como um processo Node.js e utiliza um PostgreSQL comum. Cada instalação tem seu banco, sua configuração `.env` e seu endereço de retorno OAuth. O navegador e o servidor precisam acessar Google para um novo login; os dados e as sessões são mantidos pela instalação.

## 1. Preparar a máquina

Instale [Node.js 22 ou superior](https://nodejs.org/en/download), [PostgreSQL 16 ou superior](https://www.postgresql.org/download/) e Git pelos instaladores ou pacotes nativos do seu sistema. As ferramentas `psql`, `pg_dump` e `pg_restore` devem estar disponíveis no terminal. No Windows, adicione a pasta `bin` da instalação PostgreSQL ao `PATH` ou abra seu terminal nessa pasta.

No macOS com Homebrew:

```sh
brew install node postgresql@16
brew services start postgresql@16
```

Adicione a pasta `bin` do PostgreSQL ao `PATH` conforme a instrução apresentada pelo Homebrew. Em Linux e Windows, mantenha o serviço PostgreSQL iniciado e configurado para iniciar com o sistema.

Confira as versões e instale o projeto:

```sh
node --version
npm --version
psql --version
git clone https://github.com/ernande-f/chip-ppi.git
cd chip-ppi
npm ci
```

`npm ci` instala as versões do lockfile. Não é preciso instalar compiladores ou serviços de autenticação adicionais.

## 2. Criar o PostgreSQL da aplicação

Abra `psql` com uma conta administradora do PostgreSQL. Exemplos conforme a instalação:

| Sistema | Comando comum |
| --- | --- |
| macOS/Homebrew | `psql postgres` |
| Linux | `sudo -u postgres psql` |
| Windows | `psql -U postgres -d postgres` |

No console SQL, execute uma vez:

```sql
CREATE ROLE chip LOGIN;
\password chip
CREATE DATABASE chip OWNER chip;
ALTER DATABASE chip SET timezone TO 'America/Sao_Paulo';
\q
```

`\password` pede a senha sem colocá-la no comando ou no histórico SQL. Use uma senha própria para cada instalação. A conta `chip` não precisa de `SUPERUSER` nem de `CREATEDB`: ela administra somente seu banco.

Teste a conexão local:

```sh
psql -h 127.0.0.1 -U chip -d chip
```

Mantenha a porta PostgreSQL restrita à máquina local; os usuários acessam o CHIP pelo navegador, nunca o banco. Para um PostgreSQL em outra máquina administrada pela escola, configure a rede e TLS entre os servidores e use a conexão adequada em `DATABASE_URL`.

## 3. Configurar o CHIP

Copie `.env.example` para `.env` com `cp .env.example .env`; no PowerShell, use `Copy-Item .env.example .env`. Edite os valores obrigatórios:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
DATABASE_URL=postgresql://chip:SUA_SENHA@127.0.0.1:5432/chip
DATABASE_TIMEZONE=America/Sao_Paulo
APP_URL=http://localhost:3000
APP_SESSION_SECRET=SUA_CHAVE_ALEATORIA
GOOGLE_CLIENT_ID=SEU_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=SEU_CLIENT_SECRET
GOOGLE_ALLOWED_DOMAINS=aluno.iffar.edu.br,iffarroupilha.edu.br
TRUST_PROXY=false
```

Se a senha do banco tiver caracteres especiais, codifique apenas o componente de senha da URL: por exemplo, `@` como `%40` e `#` como `%23`. Não publique `.env`. No Linux/macOS, restrinja a leitura com `chmod 600 .env`; no Windows, restrinja a leitura à conta que executa o aplicativo.

Gere a chave da sessão e coloque o resultado em `APP_SESSION_SECRET`:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Essa chave assina as sessões locais. Mudar a chave encerra as sessões existentes. Preserve-a após reiniciar ou atualizar a instalação e use uma chave própria em cada instalação independente.

`HOST=127.0.0.1` mantém o processo acessível na própria máquina. No servidor, um proxy HTTPS deve encaminhar as requisições para esse endereço. `APP_URL` é o endereço usado no navegador e não deve conter um caminho adicional.

## 4. Configurar Google OAuth

No Google Cloud, configure a audiência/tela de consentimento e crie um cliente OAuth do tipo **Aplicativo da Web**. Cadastre as URIs de retorno necessárias:

```text
http://localhost:3000/api/auth/google/callback
https://chip.SEU_DOMINIO/api/auth/google/callback
```

Cada URI precisa coincidir exatamente com `APP_URL` seguido de `/api/auth/google/callback`, inclusive esquema, hostname e porta. Fora de localhost, Google exige HTTPS e um domínio; o IP privado do servidor não serve como URI de retorno. Um domínio da escola pode resolver dentro da rede, desde que seja válido, acessível pelos navegadores que usarão o CHIP e tenha certificado HTTPS confiável. [Documentação Google](https://developers.google.com/identity/protocols/oauth2/web-server#redirect-uri-validation).

Um cliente interno Workspace aceita somente sua organização. Se alunos e servidores pertencerem a organizações diferentes, configure uma audiência que aceite ambos. Durante testes com audiência externa, cadastre os usuários de teste. Preencha `GOOGLE_ALLOWED_DOMAINS` com os domínios Workspace autorizados, separados por vírgulas.

O firewall do servidor precisa permitir saída HTTPS para os endpoints Google de autenticação e validação de tokens; o navegador também precisa alcançar a página de login do Google. Google OAuth continua exigindo internet para entrar. Não configure Supabase para autenticar usuários.

## 5. Inicializar e iniciar

Na pasta do projeto:

```sh
npm run db:setup
npm run db:check
npm run doctor
npm start
```

O setup cria a estrutura do banco indicado em `DATABASE_URL` e aplica as migrações incluídas. Não copia registros do banco antigo. Para preservar dados existentes, conclua a [migração de dados](../README.md#migrar-dados-existentes-para-postgresql-local) antes de fazer login no destino.

Confira http://localhost:3000/api/health e abra http://localhost:3000. A saúde retorna HTTP 200 quando o banco e o schema estão prontos; HTTP 503 indica que a instalação precisa de correção. `npm run doctor` explica problemas de configuração/conexão sem imprimir credenciais.

Faça um login institucional e confira a criação do perfil. A primeira conta entra como estudante. Para promover a pessoa responsável pela instalação, conecte ao banco como `chip` e execute, usando o e-mail real já autenticado:

```sql
UPDATE usuario
SET nivel_acesso = 2
WHERE lower(email) = lower('responsavel@iffarroupilha.edu.br')
  AND google_sub IS NOT NULL
RETURNING id_usuario, nome, email, nivel_acesso;
```

Confira se o resultado contém somente a pessoa pretendida. Os níveis são `0` solicitante, `1` técnico e `2` administrador. Sair e entrar novamente permite conferir o acesso. Nenhum domínio concede privilégios administrativos automaticamente.

## 6. Servidor da escola com HTTPS

Configure um nome DNS, por exemplo `chip.escola.edu.br`, e um certificado HTTPS confiável nesse servidor ou no proxy da escola. O processo Node.js continua em `127.0.0.1:3000`. No `.env` de produção:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
APP_URL=https://chip.escola.edu.br
TRUST_PROXY=loopback
```

`loopback` confia somente no proxy da própria máquina. Se a escola usar um proxy em outra máquina, informe somente o IP ou a faixa confiável desse proxy. Não use confiança irrestrita. Cadastre a URI HTTPS no cliente Google.

Exemplo para Nginx na mesma máquina, adaptando domínio e caminhos do certificado:

```nginx
server {
    listen 80;
    server_name chip.escola.edu.br;
    return 301 https://chip.escola.edu.br$request_uri;
}

server {
    listen 443 ssl;
    server_name chip.escola.edu.br;
    ssl_certificate /CAMINHO/DO/CERTIFICADO/fullchain.pem;
    ssl_certificate_key /CAMINHO/DO/CERTIFICADO/privkey.pem;
    client_max_body_size 3m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

O exemplo substitui os cabeçalhos recebidos do navegador para permitir ao aplicativo reconhecer HTTPS e o IP do usuário. [Referência Nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header). Valide com `sudo nginx -t` antes de recarregar. Mantenha a porta 3000 e a porta do banco internas.

Para manter o processo iniciado no Linux, crie uma conta de serviço `chip` e coloque o projeto em `/opt/chip-ppi`, com `.env` acessível a essa conta. Instale dependências e aplique o setup antes de ativar o serviço. Exemplo de `/etc/systemd/system/chip.service`:

```ini
[Unit]
Description=CHIP - Controle de Hardware e Itens de Projeto
After=network.target postgresql.service

[Service]
Type=simple
User=chip
Group=chip
WorkingDirectory=/opt/chip-ppi
ExecStart=/usr/bin/node backend/server.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

Adapte `ExecStart` ao caminho absoluto informado por `command -v node`. O serviço usa `.env` na pasta do projeto e não carrega configurações de `nvm` do seu shell. `ProtectSystem=strict` permite leitura dos arquivos; os dados são gravados no PostgreSQL.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now chip
sudo systemctl status chip
sudo journalctl -u chip -n 100 --no-pager
```

No macOS ou Windows, `npm start` funciona enquanto o processo estiver aberto. Para um servidor permanente nesses sistemas, configure o gerenciador nativo de serviços para executar o caminho absoluto de `node`, com argumento `backend/server.js`, diretório de trabalho do projeto e uma conta sem privilégios administrativos. Garanta que PostgreSQL também inicie com o sistema.

Confira a URI HTTPS de saúde, login Google real, permissões, imagens, criação de pedido e devolução antes de disponibilizar o serviço.

## Backup e restauração

Fotos locais fazem parte do banco. Use `pg_dump` da mesma versão principal do servidor PostgreSQL ou mais recente. Ele cria uma cópia consistente enquanto o sistema está em uso. [Documentação PostgreSQL](https://www.postgresql.org/docs/16/app-pgdump.html).

Exemplo de backup com senha solicitada no terminal:

```sh
pg_dump -h 127.0.0.1 -U chip -d chip -Fc --no-owner --no-acl -f chip-backup.dump
```

Guarde backups com data em local fora do disco do servidor e mantenha uma cópia protegida de `.env` separadamente. Para automatizar, configure `.pgpass`/`pgpass.conf` com as permissões exigidas pelo PostgreSQL; evite colocar senhas em scripts ou no histórico. Nunca coloque backups com dados pessoais no Git.

Para testar a recuperação sem substituir o banco em uso, crie um banco vazio `chip_restore` pertencente a `chip`, como administrador PostgreSQL:

```sql
CREATE DATABASE chip_restore OWNER chip;
ALTER DATABASE chip_restore SET timezone TO 'America/Sao_Paulo';
```

Restaure nele, sem executar `db:setup` antes:

```sh
pg_restore -h 127.0.0.1 -U chip -d chip_restore --no-owner --no-acl --single-transaction chip-backup.dump
```

O arquivo restaura schema, registros, fotos e sequências; o banco precisa estar vazio. [Referência de restauração](https://www.postgresql.org/docs/16/app-pgrestore.html). Configure uma cópia do aplicativo com `DATABASE_URL` apontando para `chip_restore`, aplique `npm run db:setup` para atualizar a estrutura à versão do código e confira `db:check`, catálogo e pedidos.

Em uma recuperação real, pare o aplicativo antes da troca de conexão e mantenha o banco anterior até validar a restauração. O backup de `.env` recupera credenciais OAuth e a chave de sessão; alterar essa chave exige novo login.

## Atualizar uma instalação

Registre a versão em uso e faça backup antes de atualizar. No Linux com o serviço de exemplo:

```sh
sudo systemctl stop chip
git pull --ff-only
npm ci --omit=dev
npm run db:setup
npm run db:check
npm run doctor
sudo systemctl start chip
```

Execute os comandos do projeto com a conta responsável pelos arquivos. `git pull --ff-only` interrompe a atualização quando há divergência de histórico. Confira `/api/health` e login após iniciar. Voltar apenas o código não desfaz migrações de dados: utilize o backup validado para uma recuperação completa.

## Diagnóstico rápido

| Sintoma | Verificação |
| --- | --- |
| Aplicativo encerra ao iniciar | Rode `npm run doctor`; confira Node, `.env`, porta e chave de sessão. |
| Conexão recusada ou saúde 503 | Confira serviço PostgreSQL, `DATABASE_URL`, usuário/senha e `npm run db:setup`. |
| `redirect_uri_mismatch` | Cadastre exatamente `APP_URL/api/auth/google/callback` no Google. |
| Domínio recusado | Confira `GOOGLE_ALLOWED_DOMAINS` e a organização Workspace da conta. |
| Repetição de redirecionamento HTTPS | Confira `APP_URL`, `TRUST_PROXY` e `X-Forwarded-Proto` do proxy. |
| Erro 413 ao cadastrar foto | Foto deve ter até 2 MB; o proxy precisa aceitar até 3 MB de JSON. |
| Registros antigos ausentes | Setup cria o schema; a cópia da origem e das imagens é separada. |
