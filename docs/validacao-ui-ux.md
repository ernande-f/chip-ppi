# Correções de UI/UX e teste de volume — 05/11/2026

## Correções concluídas

Cada um dos onze itens recebeu um agente responsável. As alterações foram integradas e verificadas no checkout atual.

1. Seletor de foto nativo e acessível por teclado no cadastro/editor, preservando obrigatoriedade e limite de 2 MB.
2. Modais de informações e saída com foco inicial, contenção de Tab, Escape, retorno ao acionador e semântica acessível.
3. Filtro de situação do estoque aplicado no servidor antes da paginação, reiniciando na página 1.
4. Busca executa a intenção mais recente e descarta respostas/erros de pesquisas antigas, inclusive durante paginação.
5. Catálogo permite expandir nome e descrição completos, por teclado e com texto ampliado.
6. Login respeita alto contraste persistido/do sistema e redução de movimento, com controle também no celular.
7. Contraste corrigido nos botões Google e adicionar; menor razão medida entre os estados testados: 5,04:1.
8. Carrinho e notificações preservam foco; remoções levam ao vizinho ou resumo vazio.
9. Carrinho e edição de perfil bloqueiam envios concorrentes e comunicam processamento/erros sem perder dados.
10. Adicionar ao carrinho apresenta confirmação persistente com nome/quantidade, processamento e link para continuar.
11. Novas notificações levam ao pedido/usuário citado; IDs e destinos são validados e os detalhes respeitam os dados autorizados.

Notificações antigas com destino genérico continuam genéricas. As 60 mil notificações fictícias foram criadas/atualizadas com destino específico.

## Paginação do catálogo

A API já usava `page`/`limit`, contagem total e `hasMore`. O frontend solicita 20 produtos por vez e carrega a próxima página pela rolagem. Não há navegação visual por números de página.

Foram verificadas cinco páginas sem IDs repetidos, a última página (435 para os 8.688 produtos disponíveis da carga), arquivados filtrados antes do limite e a passagem de 20 para 40 cartões em navegador a 390 px.

## Limpeza e carga executadas

O usuário autorizou apagar a base atual, sem backup. `.env` e `.env.local` apontavam ao mesmo PostgreSQL local `127.0.0.1/chip_local`, fora de produção. O serviço PostgreSQL foi iniciado.

Limpeza e inserts foram confirmados numa única transação. O vínculo da conta administrativa institucional foi recriado para manter o acesso, com novo identificador de sessão. Os demais registros anteriores foram removidos. Não foi criado backup.

| Dados | Quantidade inicial após carga |
| --- | ---: |
| Produtos / categorias | 10.000 / 40 |
| Usuários fictícios / conta administrativa recriada | 3.000 / 1 |
| Pedidos / itens de pedidos | 30.000 / 90.000 |
| Pedidos ativos | 3.000 |
| Notificações | 60.000 |
| Auditoria | 106.900 |
| Renovações pendentes | 600 |
| Histórico inicial de estoque | 10.000 |

Os usuários fictícios usam `example.invalid` e não possuem login Google. Produtos usam uma foto local compartilhada: o ensaio exercita quantidade de registros, consultas e interface; não simula 10 mil fotografias distintas. A fila sintética fica desativada para e-mail. Workers podem acrescentar lembretes após a carga.

Para repetir **a limpeza destrutiva**, mantendo um administrador Google ativo:

```sh
node --env-file=.env.local scripts/seed-stress.mjs --reset
```

Para medir a base populada, sem repetir a limpeza:

```sh
node --env-file=.env.local scripts/stress-local.mjs
```

O ensaio sobe um servidor temporário local, desativa envio de e-mail nesse processo, usa sessão assinada localmente para a conta administrativa e encerra o servidor ao terminar. Não adiciona caminho de autenticação à aplicação.

## Resultados neste computador

| Cenário | Resultado |
| --- | --- |
| 100 consultas ao catálogo, concorrência 10 | 100 respostas HTTP 200 |
| Mediana / percentil 95 / máximo desse lote | 12 / 24 / 26 ms |
| Última página do catálogo | 76 ms |
| Gestão: resposta com 30 mil pedidos | 1.026 ms; 35.506.901 bytes |
| Kanban: 3 mil cartões ativos, Chromium a 390 px | 1.206 ms |
| Relatório padrão | 1.425 ms; cerca de 2,95 MB |

A consulta de devoluções varria toda a auditoria para cada pedido. Foi adicionado `idx_log_devolucao_pedido` em `database/migrations/indexes.sql`. O trecho medido com 100 pedidos passou de 1.198,610 ms para 0,819 ms; esse número é do trecho SQL, não da página inteira.

**Pendência de escala:** a gestão ainda transfere todos os pedidos. A paginação do histórico é feita no cliente e não reduz os cerca de 35 MB recebidos. Uma próxima mudança deve paginar/filtrar no servidor e limitar o volume inicial do quadro. Localhost não representa conexão móvel ou hardware real de celular.

## Validação

- 64 testes Node passaram.
- Os 15 scripts de UI passaram, incluindo as regressões dos onze itens em larguras pertinentes de 320, 390 e 1280 px; o catálogo também cobriu larguras intermediárias.
- Ponta a ponta com PostgreSQL temporário passou: migrações, permissões, estoque, carrinho/termo, pedidos, devoluções/danos, prazos, Kanban, logout e cópia de dados antigos.
- Notificações com PostgreSQL temporário passaram: privacidade, paginação, deduplicação, lembretes/concorrência e fila, sem envio real.
- `npm run db:check` passou na base populada.

```sh
npm test
npm run test:ux
```

Sem homologação em aparelho físico, leitor de tela, Safari/WebKit ou login Google real. Não foi feito benchmark MySQL nem simulação de mil usuários simultâneos.
