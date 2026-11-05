# PostgreSQL ou MySQL no CHIP

Análise de código/documentação em 05/11/2026. Não é migração implementada nem benchmark comparativo.

## Conclusão

MySQL pode atender catálogo, estoque, pedidos, usuários e relatórios. Para o estado atual, recomendo manter PostgreSQL, salvo exigência institucional ou vantagem concreta de hospedagem/operação. O custo da troca está no backend e na validação de concorrência; não numa incapacidade do MySQL.

Não foi encontrada justificativa formal da escolha original. Existem referências históricas a Supabase, mas o README atual documenta PostgreSQL próprio e Google OAuth, sem Supabase em execução. Atribuir toda a decisão histórica ao Supabase seria uma inferência.

## Dependências concretas

O driver `postgres` em `backend/db.js`, a validação da conexão, schema, migrações e serviços foram escritos para PostgreSQL. Transações, travas e índices sustentam reservas/retornos de estoque, concorrência do carrinho e auditoria.

| Parte atual | Adaptação para MySQL |
| --- | --- |
| Driver com SQL parametrizado em tagged templates | Trocar driver e adaptar parâmetros, transações e resultados. Mudar somente a URL não funciona. |
| `RETURNING` e `ON CONFLICT` | Usar IDs retornados pelo driver, consultas complementares e `ON DUPLICATE KEY UPDATE`, conforme o caso. |
| `jsonb_agg`, `jsonb_build_object`, `FILTER`, `ILIKE`, casts `::`, `LATERAL` e cálculos de datas | Reescrever consultas preservando ordenação, nulos, datas e contratos JSON. MySQL tem JSON nativo. |
| `pg_advisory_xact_lock` e `FOR NO KEY UPDATE` | Rever estratégia de travas, não apenas renomear funções. |
| `UUID`, `timestamptz`, identity e índices específicos | Adaptar tipos, geração de IDs, fusos, índices e migrações. |
| Instalação, diagnóstico, cópia, carga e testes | Portar ferramentas e repetir as regressões com MySQL real. |

Os principais arquivos envolvidos são `backend/config.js`, `backend/db.js`, os serviços, `database/schema.sql`, `database/migrations` e scripts que acessam o banco. O frontend pode ser preservado se os contratos HTTP continuarem iguais.

## Pontos sensíveis

Reserva e devolução de estoque precisam continuar corretas sob operações simultâneas, assim como checkout, renovações, penalidades e fila de notificações.

InnoDB oferece `FOR UPDATE` e `SKIP LOCKED`. Entretanto, `GET_LOCK()` é uma trava de sessão, não liberada automaticamente por commit/rollback; não substitui diretamente `pg_advisory_xact_lock`. O isolamento também precisa ser escolhido: o padrão InnoDB é `REPEATABLE READ`, enquanto trechos atuais esperam enxergar alterações confirmadas depois de adquirir uma trava.

RLS não é o motivo decisivo para manter PostgreSQL aqui: a instalação usa o proprietário das tabelas, que normalmente ignora RLS. As permissões individuais atuais estão principalmente no backend e devem ser preservadas na migração.

## Escopo mínimo da troca

1. Escolher versão MySQL/InnoDB, collation, tipos, fuso e isolamento.
2. Portar conexão, schema e migrações.
3. Adaptar SQL e travas, preservando contratos HTTP.
4. Adequar instalação, diagnóstico, carga e testes.
5. Validar concorrência, estoque, permissões, datas e relatórios; comparar desempenho em cenários equivalentes.

O escopo é médio/alto no backend. A limpeza recente reduz o transporte de dados legados, mas não elimina adaptação e testes. Não há evidência para prometer ganho de desempenho. O gargalo observado no teste de volume foi corrigido com índice PostgreSQL.

## Referências primárias consultadas

- [MySQL 8.4 — INSERT](https://dev.mysql.com/doc/refman/8.4/en/insert.html)
- [MySQL 8.4 — JSON](https://dev.mysql.com/doc/refman/8.4/en/json.html)
- [MySQL 8.4 — locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)
- [MySQL 8.4 — locking functions](https://dev.mysql.com/doc/refman/8.4/en/locking-functions.html)
- [MySQL 8.4 — isolation](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html)
- [PostgreSQL 16 — advisory locks](https://www.postgresql.org/docs/16/explicit-locking.html#ADVISORY-LOCKS)
- [PostgreSQL 16 — row security](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)
