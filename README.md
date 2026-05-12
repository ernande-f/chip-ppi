Nossa estrutura foi dividida para organizar melhor o código:

- **`/frontend/`**: Onde ficam nossas páginas (HTML), estilos (CSS), scripts do navegador e imagens (`assets/`). Quando for criar ou editar uma tela, é aqui que você deve mexer!
- **`/backend/`**: Onde fica o nosso servidor local (`server.js`) e as configurações do banco de dados.

## 💻 Como Rodar o Projeto

1. Abra o terminal nesta pasta (`chip-ppi`).
2. Digite o comando: `npm install` *(apenas na 1ª vez de cada integrante)*.
3. Digite o comando: `npm run dev` para ligar o servidor.
4. Acesse no navegador: [http://localhost:3000](http://localhost:3000)

**Dicas:**
* Se editar algo no **frontend**, é só dar F5 / atualizar a página no navegador.
* Se editar algo no **backend** (`server.js`), o terminal reinicia o servidor sozinho.

## Auth no desenvolvimento

Para desativar a confirmação de email no cadastro enquanto estiver desenvolvendo, defina no `.env`:

```bash
SUPABASE_DISABLE_EMAIL_CONFIRMATION=true
```

Com isso, a rota `/api/register` cria o usuário já confirmado via Admin API do Supabase, evitando bloqueio por rate limit de email.
