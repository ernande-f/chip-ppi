# Estado do CHIP e plano de conclusão

Revisão de 22/10/2026, baseada no código, no **CHIP — Documento oficial, versão 5**, em **CHIP_Cronograma.xlsx**, aba **Página2**, e nos requisitos permanentes de celular e acessibilidade solicitados pelo usuário nesta data e registrados em `AGENTS.md`. Os documentos originais não foram alterados. Esta matriz registra evidência de implementação; homologação na instalação real é uma etapa separada.

Os identificadores se repetem no documento: **§5** corresponde aos requisitos de usuário; **§7**, aos requisitos de sistema. O próprio documento determina que requisitos e casos de uso textuais revisados prevalecem sobre imagens, modelos e protótipos antigos.

## Implementado e verificado localmente

| Área | Estado e evidência | Fonte oficial | Cronograma |
|---|---|---|---|
| Autenticação institucional e perfil | Google OAuth validado no servidor, criação/vínculo por identidade institucional, edição do próprio nome e logout com revogação de sessão. `googleAuth.js`, `userProfile.js`, `sessionAuth.js`, `authSession.js`. | §5 RF01–05; §7 RF01–04/RF27 | C15:H18 marcam concluído, mas descrevem a tecnologia anterior. Recuperação de senha é externa, pelo Google. |
| Catálogo público e gestão de itens | Busca por nome/categoria/cor, cadastro, edição de estoque e arquivamento. `productService.js`, catálogo público e técnico. Tratamento de fotos tem divergência abaixo. | §5 RF03/RF06–07/RF16–19; §7 RF10; §7 RNF08 | C22:H24 e C33:H33 concluídos. |
| Carrinho e checkout | Adicionar/editar/remover, validar disponibilidade, reservar estoque em transação; duração de 1–15 dias e limite de 3 ativos. `orderService.js`, `orderRules.js`, `student-orders.js`. | §5 RF08–10; §7 RF06–07/RF22/RF24/RF26 | C25:H26 e C32:H32 concluídos. |
| Termo de responsabilidade | Checkout registra usuário, data, hora e versão do aceite. Página pública e modal padronizados na versão 3, com a mesma redação sobre devoluções parciais/danos e navegação por teclado. | §7 RF05 | C46:H46: revisões pontuais em andamento na planilha original. |
| Pedidos e Kanban | Aprovação, negativa com motivo, separação, prontidão, retirada e devolução; transições validadas no servidor. Cinco colunas ativas, histórico expansível, busca, filtros de período/situação e Ver mais até consultar todos os pedidos. Filtros do histórico não ocultam ativos. | §5 RF11/RF20–23; §7 RF16 | C28:H30 concluídos; melhoria de C42:H42 entregue nesta revisão. |
| Prazos, expiração e cancelamento | Até 10 dias corridos após aprovação para retirada; separação/prontidão não reiniciam prazo. Expiração automática e cancelamento pelo solicitante antes da retirada liberam estoque uma vez. Duração começa na retirada efetiva. | §7 RF08–09/RF16–17/RF24 | A planilha não detalha essas regras; constam do documento revisado. |
| Histórico de pedidos | Tela do solicitante recebe histórico completo; equipe recebe o histórico geral. `listUserOrders`, `listManagedOrders` e `queryOrders` não limitam a cinco pedidos. O perfil mostra apenas cinco recentes como resumo. Histórico técnico permite períodos de hoje/7/30/90 dias ou todo o período, situação e páginas de 12 via Ver mais. | §5 RF12/RF27 | C31:H31 concluído. |
| Devoluções e estoque | Conferência por unidade recebida/danificada, somente unidades boas voltam ao estoque. Pedido continua Retirado enquanto faltam unidades. Histórico de ocorrências para solicitante/equipe; auditoria dos totais antes/depois, IP e observação. Saldo anterior obrigatório no formulário impede reenvio ou recebimento com tela obsoleta. | §5 RF23; §7 RF08 | C37:H37 complementado e testado nesta revisão. |
| Bloqueio respeitado e permissões | Middleware recusa conta bloqueada nas funções restritas; catálogo continua público. Níveis 0/1/2 separam solicitante/técnico/admin. Gestão e penalidades por atraso foram entregues nesta etapa, detalhadas abaixo. | §5 RF29–30; §5 RNF03 | C44:H45 estavam em andamento/pendentes na planilha original. |
| Auditoria e instalação | Mudanças de estado, cancelamento e expiração registram autor ou ação do sistema, data/hora, IP quando aplicável e estados anteriores/posteriores. PostgreSQL próprio, migrações, cópia de dados e guia de instalação/backup existem. | §7 RF15; arquitetura §6 | As referências a Supabase da planilha são históricas. |

## Entregas feitas nesta etapa

As situações abaixo descrevem o código e a instalação local em 22/10/2026. As células citadas preservam o estado da planilha recebida; o arquivo original não foi atualizado automaticamente.

| Entrega | Comportamento entregue | Fonte e situação da planilha original | Evidência atual |
|---|---|---|---|
| Pesquisa de usuários e histórico por usuário | Técnico/admin pesquisam usuários, navegam por páginas e consultam o histórico completo do perfil selecionado. | §5 RF26/RF31. C43:H43 em andamento. | API e tela de usuários integradas à navegação; histórico restrito à equipe, sem depender da busca no Kanban geral. |
| Gestão administrativa | Apenas admin altera nome de terceiros, níveis e bloqueio/desbloqueio. Há motivo obrigatório nas alterações de acesso, auditoria e revogação de sessões. O sistema protege o próprio acesso, impede bloquear outro administrador e preserva o último administrador ativo. | §5 RF04/RF29–30; §5 RNF03/RNF06; §7 RF27. C44:H44 em andamento; C45:H45 pendente. | `accountService.js`, API e interface de gestão, com testes de permissão e concorrência. O primeiro administrador da instituição continua sendo uma etapa de configuração. |
| Bloqueio automático por atraso | Ao concluir a devolução completa, calcula 1 dia de bloqueio por dia de atraso sobre o prazo efetivo, incluindo renovações aprovadas. Registra início, término e pedido; acumula penalidades sem duplicá-las e libera automaticamente na data limite pelo relógio do banco. Admin pode encerrar a penalidade com motivo e auditoria. | §5 RF24. C45:H45 pendente. | Migração `user_management.sql`, `applyLateReturnPenalty`, histórico de penalidades e revogação de sessões. Devolução parcial mantém o pedido aberto; o cálculo ocorre no fechamento. |
| Renovação | Solicitante informa justificativa/nova data para pedido próprio Retirado. Equipe aprova/nega com registro da decisão; até 15 dias por extensão e no máximo 2 aprovações. O prazo só muda após aprovação. | §5 RF13/RF25; §7 RF23/RF26; caso Estender prazo. C40:H40 pendente. | Migração `loan_renewals.sql`, serviço, API e formulários do solicitante/equipe. Prazo aprovado alimenta as telas, os lembretes e o cálculo de atraso. Devolução completa encerra solicitações ainda pendentes. |
| Pedir novamente | Copia itens de pedido próprio para o carrinho respeitando disponibilidade atual, informa reduções e itens indisponíveis/arquivados. O usuário revisa o carrinho e aceita novamente o termo antes de criar outro pedido. | §5 RF14; §7 RF25; caso Pedir novamente. C41:H41 pendente, prioridade alta. | Serviço, API e ação no histórico, com validação de autoria, estoque e concorrência. |
| Relatórios por período | Exibe itens que chegaram a 100% emprestado no intervalo, itens do acervo atual sem retirada, rankings de itens mais e menos emprestados por quantidade retirada e estatísticas gerais. Detalhes dos pedidos têm filtros inclusivos de solicitação/situação, danos e tempo médio. | §5 RF28; §7 RF18–19. C38:H38 pendente, prioridade alta. | `reportService.js`, API e tela de relatórios. Exporta CSV compatível com Excel, com BOM e proteção contra fórmulas, e impressão para salvar PDF. **Não há exportação XLSX nativa.** |
| Notificações internas e fila de e-mail | Aprovação/negativa, pronto para retirada, devoluções, decisões de renovação e lembretes 2 e 1 dia antes do prazo. Lista pessoal com paginação, filtro de não lidas, leitura individual/em lote e indicação na navegação. Fila assíncrona registra tentativas e evita duplicação de eventos/envios. | §5 RF15; §7 RF13–14. C39:H39 em andamento, prioridade baixa. | Migração `notifications.sql`, `notificationService.js`, APIs e interface. Integração Resend implementada, mas **envio desativado na instalação** por falta de chave e remetente. Eventos criados com envio desativado não serão enviados retroativamente ao habilitar o serviço. |
| Celular e acessibilidade | Menu de navegação acessível, opção persistida de alto contraste, suporte às preferências do sistema, foco visível, rótulos e estados textuais. Ajustes de layout, formulários e tabelas em telas pequenas. | Solicitação permanente do usuário de 22/10/2026, `AGENTS.md`; complementa §7 RNF07. | Validação automatizada de interfaces em 320/390/1280 pixels e de navegação por teclado. Aparelho real e tecnologias assistivas permanecem na homologação. |

Os indicadores de utilização consideram a **data da retirada efetiva**, independentemente da situação selecionada. Itens sem empréstimo são os do acervo atual não arquivado sem retirada no intervalo, inclusive nunca solicitados; não representam uma reconstrução do acervo de épocas anteriores. O histórico `historico_uso_estoque` registra os saldos disponível, reservado e emprestado após movimentações transacionais. O relatório conta as entradas no estado 100% emprestado durante o período, sem duplicar leituras contínuas e sem confundir reservas ou estoque vazio com empréstimos. O saldo inicial da migração é apenas uma observação e não conta como chegada a 100%; não há comprovação retroativa anterior ao início do acompanhamento, cuja data aparece na tela e no CSV. Itens arquivados depois continuam no histórico de utilização.

Os detalhes dos pedidos consideram a **data da solicitação**, inclusive para pedidos do histórico, e mostram a situação/quantidades atuais. A taxa de danos usa unidades danificadas divididas pelas recebidas, incluindo devoluções parciais; a média usa a diferença entre retirada e devolução completa dos pedidos concluídos com ambas as datas válidas. Ausência de dados aparece como “Sem dados”, sem inventar médias ou taxas iguais a zero. Danos antigos que não foram registrados não podem ser reconstruídos.

## Identificação sem CPF

Por decisão expressa do usuário em 22/10/2026, CPF foi retirado do sistema. Não há campo nas telas, máscara, coleta, validação ou retorno nas APIs. O schema novo não possui a coluna; `remove_cpf.sql` remove a coluna e seus dados das instalações anteriores, além de campos de mesmo nome em objetos e arrays JSON de auditoria. Registros sem esse campo, textos de auditoria não estruturados, pedidos e permissões são preservados. O importador de bancos antigos descarta esses campos sem modificar a origem. Backups externos anteriores não foram regravados; sua restauração exige aplicar as migrações antes de usar o sistema. A decisão prevalece sobre documentos e modelos antigos e está registrada em `AGENTS.md`.

A migração foi aplicada ao banco local em 22/10/2026; a coluna não existe e a verificação de saúde do servidor retornou HTTP 200. Validação: 64 testes unitários, fluxo local com PostgreSQL temporário e gestão de contas passaram. Foram conferidos a reaplicação idempotente da migração, auditoria com campos aninhados, importação legada e ausência do campo nas respostas de sessão, consulta e edição do perfil.

## Pendências reais para conclusão

| Entrega | Critério de conclusão | Fonte e situação da planilha | Limite atual |
|---|---|---|---|
| Fotos | Receber JPG/PNG/WebP de até 5 MB, converter para WebP e redimensionar para 800×800. | §7 RF11–12; complementa C22:H24 e C33:H33. | Limite atual de 2 MB, sem conversão/redimensionamento; divergência detalhada abaixo. |
| Retenção e anonimização | Eventos de auditoria por 5 anos; dados pessoais anonimizados após 2 anos inativos, inclusive nos logs; eventos restantes preservados sem identificação. | §7 RNF04–05. Sem tarefa específica na planilha. | Não há rotina de anonimização/expurgo nem rastreio de última atividade para essa política. |
| Ativação do e-mail institucional | Configurar e validar chave Resend, remetente e domínio; habilitar o envio e conferir entrega/falhas com destinatários autorizados. | §5 RF15; §7 RF13–14. C39:H39 em andamento na planilha original. | Integração pronta, sem envio real habilitado nesta instalação. Não haverá envio retroativo dos eventos registrados como desativados. |
| Homologação mobile e assistiva | Operar os fluxos em aparelho real, conferir toque/rolagem, zoom, contraste e uso com leitor de tela. | Requisito permanente do usuário, `AGENTS.md`; §7 RNF07. | Testes de viewport e teclado passaram; não substituem validação física e assistiva. |
| Homologação institucional e produção | Login Google institucional real, instalação/HTTPS/OAuth, carga, tempos de resposta e restauração de backup no ambiente final. | §7 RNF01–03/RNF06; fase novembro–dezembro da seção 10. | Testes locais e migrações aplicadas não comprovam a operação em produção. |

## Divergências e decisões

- **Devolução por condição corrigida:** o documento §7 RF08 exige que faltantes/danificados não voltem ao estoque. A implementação anterior devolvia todas as unidades; agora a conferência parcial registra recebidas/danificadas e repõe somente unidades boas. Isso fornece os dados necessários para a taxa de danos de novos recebimentos; não é possível reconstruir danos antigos não registrados. A planilha C45:D45 menciona bloqueio por atraso/danos, mas o texto atualizado define a fórmula somente para atraso. Não existe fórmula documentada de penalidade por dano.
- **Fotos:** §7 RF11–12 pede WebP, 800×800 e entrada JPG/PNG/WebP até 5 MB. O código atual limita 2 MB, aceita também GIF/URL e não converte nem redimensiona. É necessário adequar o processamento ou revisar formalmente o requisito.
- **Identificação de professores corrigida:** §7 RF20 distingue estudante/professor pelo domínio institucional. O perfil de nível 0 com domínio `@iffarroupilha.edu.br` recebe o rótulo Professor; o nível de solicitante permanece 0. Técnico e administrador têm precedência sobre o domínio, com verificação unitária da identificação e da ausência de acesso técnico para Professor.
- **Caracteres no cadastro:** §5 RNF02 proíbe emojis/símbolos especiais; o validador atual não aplica essa proibição. A definição precisa preservar nomes técnicos válidos antes de impor uma lista de caracteres.
- **Materiais antigos:** Supabase nas células C5:H6, C11:H11, D15:D18, D23:D26 e D33 é referência obsoleta. Recuperação de senha C17:H17 pertence ao Google. Modelos e protótipos antigos não justificam restaurar dados pessoais retirados do escopo, senha local ou agendamento de datas futuras. `PROBLEMAS_E_MELHORIAS.md` se declara histórico e contém lacunas que já foram resolvidas.

## Etapas até dezembro de 2026

A planilha não possui datas de entrega: coluna B representa fases 1.0–4.0. As tarefas preenchidas terminam na linha 46. Os marcos mensais vêm da seção 10 do documento oficial, incluindo a marcação em cinza de sua tabela:

| Período oficial | Etapa / marco | O que falta fechar |
|---|---|---|
| Junho | Seminário 1; catálogo e gestão de itens em junho–julho | A tarefa já tem código funcional; revisar divergências de fotos/caracteres. |
| Agosto | Seminário 2 com meta de 30%; carrinho e gestão/fluxo de pedidos em agosto–setembro | Fluxo base implementado; percentuais são metas históricas do documento. |
| Setembro–outubro | Pós-empréstimo e regras; seminário 3 em outubro, meta de 60% | Devolução por condição, renovação, Pedir novamente e bloqueio automático entregues localmente; validar as regras na homologação. |
| Outubro–novembro | Administração, segurança e relatórios | Gestão de usuários, permissões/bloqueios, relatórios e notificações implementados; concluir fotos, políticas de dados e ativação do envio institucional. |
| Novembro–dezembro | Testes, ajustes e homologação; seminário 4 em dezembro, meta de 100% | Validar instalação, regras e uso real; atualizar modelos/protótipos e o estado das tarefas. |

Os documentos não informam dias exatos para os seminários. Não foi calculado percentual atual: não há pesos definidos para os requisitos, e contar células Concluído esconderia funcionalidades parciais.

Celular e acessibilidade são critérios de conclusão de cada nova tela e correção. A homologação de novembro–dezembro deve incluir aparelho real, opção de alto contraste, ampliação de texto/zoom, teclado, leitor de tela e preferências de acessibilidade do sistema.

## Evidência atual de acessibilidade e responsividade

A implementação inclui foco com `:focus-visible`, controles com rótulos, regiões de status, semântica de diálogo e navegação principal acessível. O menu permite acessar gestão, relatórios e notificações conforme a permissão. As páginas incluem viewport; formulários, tabelas, modais e navegação foram conferidos em 320, 390 e 1280 pixels.

A opção de alto contraste foi implementada, persiste a escolha e considera as preferências de acessibilidade do sistema. O Kanban respeita `prefers-reduced-motion`. Os modais de termo, pedido do solicitante e gestão têm foco inicial, navegação por Tab, fechamento com Escape, retorno do foco e bloqueio de rolagem do fundo. Estados do pedido são apresentados também por texto. Os testes locais de teclado e contraste passaram; contraste efetivo, ampliação e operação completa por leitor de tela ainda exigem homologação assistiva e em aparelho real.

## Correção da responsividade do catálogo

A revisão de 22/10/2026 reproduziu o catálogo técnico em 400×833 pixels: cabeçalho de 281 pixels e conteúdo de 618 pixels de largura, com colunas do rodapé cortadas. Os estilos específicos do catálogo não usavam a base compartilhada, mantinham uma grade mínima de 350 pixels e não reorganizavam o rodapé. As verificações anteriores de outras telas não detectavam esse caso.

O catálogo técnico, o público e o cadastro agora usam a base comum; o rodapé passa de quatro para duas e uma coluna conforme a largura. Cabeçalho agrupa atalhos e alto contraste no Menu, com busca abaixo; cartões, título, ações e formulários se ajustam à tela. O editor é rolável dentro da área visível, mantém o fundo parado, limita a navegação por Tab e fecha com Escape devolvendo o foco ao botão Alterar.

`npm run test:catalog:ui` cobre administrador, estudante e visitante em 320/360/390/400/600/720/768/900/1280 pixels. Verifica as posições reais dos elementos e linhas de texto do rodapé, sem aceitar ocultar o excesso como correção; também valida busca, filtros, menu, contraste, toque de 44 pixels nos controles principais, fonte de 16 pixels nos campos e editor sem gravar dados. Chromium passou; WebKit não está instalado. Cadastro foi conferido em 320/400/768/1280 pixels. Os 64 testes unitários, a interface de pedidos/termos/perfil e a integração completa passaram. Celular físico, teclado virtual, Safari e tecnologias assistivas permanecem na homologação.

## Ordem de conclusão

1. Adequar fotos ao limite de 5 MB e processamento WebP 800×800; resolver a definição de caracteres de cadastro.
2. Implementar retenção/anonimização e rastreio de atividade conforme a política oficial.
3. Configurar remetente/chave e homologar envio institucional, mantendo claro quais eventos foram registrados sem e-mail.
4. Homologar celular real, zoom, contraste, teclado, tecnologias assistivas e login Google institucional real.
5. Homologação institucional, restauração de backup e atualização dos modelos/protótipos e da planilha.

Celular e acessibilidade acompanham todas essas etapas; alto contraste já está disponível. A integração de e-mail requer configuração externa para ser ativada. A regra de penalidade por dano permanece sem fórmula no documento revisado; não foi inventada uma penalidade automática para esse caso. Os relatórios oferecem CSV e PDF por impressão; XLSX nativo não foi implementado.

## Implantação externa e validações ainda não comprovadas

Antes da homologação, conferir no servidor de destino PostgreSQL/migrações, fuso `America/Sao_Paulo`, HTTPS/domínio e retorno OAuth, audiência/domínios institucionais, primeiro administrador e restauração de backup. Esses procedimentos estão descritos no guia de instalação; a presença do guia não comprova sua execução na instituição.

O envio de e-mail já possui integração Resend e fila, mas permanece desativado por falta de credenciais/remetente. Login Google autentica o usuário e não fornece automaticamente um serviço de envio de mensagens. Habilitar o provedor autoriza novos eventos; os registrados como desativados não entram retroativamente na fila de envio.

Ainda é necessário comprovar login completo com conta Google real no endereço final; Chrome, Firefox e Edge; página inicial em até 5 segundos; busca em até 2 segundos com 1.000 itens; e até 50 usuários simultâneos (§7 RNF01–03/RNF06). Não houve teste de carga, teste em aparelho móvel real ou homologação com tecnologias assistivas nesta revisão.

## Validação desta revisão

A ampliação dos relatórios foi validada com 64 testes unitários e regressões de relatórios, pedidos, integração completa e fluxo local. Os testes cobrem entradas em 100% no intervalo sem contar o estado inicial ou repetir estados contínuos, fronteiras de data no fuso de São Paulo, acervo sem retirada, itens arquivados, CSV seguro, snapshots transacionais, rollback e concorrência. A migração `inventory_usage.sql` foi aplicada ao banco local em 22/10/2026; tela e exportações incluem o início do acompanhamento. Interface validada em 320/390/1280 pixels, contraste e impressão. O histórico é produzido pelos serviços do CHIP; alterações SQL externas precisam registrar a movimentação ou iniciar uma nova observação, sem inventar um evento passado.

- `npm test`: **64 testes passaram**, incluindo autenticação, perfil, regras de pedidos, devoluções, filtros do Kanban, relatórios e configuração de notificações.
- `npm run test:orders`: **passou** com PostgreSQL local temporário; migrações, estoque, danos, devoluções parciais/completas, auditoria, arquivamento e reenvios concorrentes.
- `npm run test:local`: **passou** com PostgreSQL temporário e Chromium; fluxo real de catálogo/carrinho/checkout/gestão, devolução parcial com dano e posterior conclusão, permissões, estoque, expiração, privacidade e cópia de dados.
- `npm run test:ui`: **passou** em navegador com dados simulados em 320/390/1280 pixels; termo e aceite, foco/teclado, layout do perfil/carrinho, histórico de ocorrências, filtros e Ver mais do Kanban (28 pedidos do histórico em três páginas).
- Regressões de contas, empréstimos, relatórios e notificações **passaram**: permissões e histórico por usuário, bloqueios manuais/automáticos, sessões e auditoria, duas renovações, prazo efetivo da penalidade, repetição do pedido no carrinho, agregação de relatórios, CSV seguro, notificações pessoais, fila, idempotência e lembretes. O transporte de e-mail foi simulado; não houve envio real.
- Integração com o servidor completo (`feature-regressions`) **passou**, com rotas e páginas protegidas; testes de interface incluíram gestão, relatórios, notificações, menu, contraste e teclado.
- As migrações de usuários/penalidades, renovação e notificações foram **aplicadas à instalação local**; os routers foram integrados ao servidor.
- `npm run doctor`: **passou**, com configuração local e banco prontos, fuso America/Sao_Paulo. Não autentica uma conta Google real.
- Verificação de sintaxe dos arquivos JavaScript e `git diff --check`: **passaram**.

Os bancos utilizados pelos testes de pedidos e integração são temporários e removidos ao terminar. Os documentos oficiais não foram alterados. A instalação local recebeu as migrações necessárias à nova entrega; isso não representa implantação nem homologação em produção. O sistema ainda não deve ser declarado 100% concluído enquanto as pendências reais acima não forem fechadas.
