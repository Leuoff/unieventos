# Entrega — Etapa 6: movimentações de equipamentos

## Revisão e preservação

Foram revisados o schema Prisma, os serviços, componentes, permissões, testes, README e documentos das entregas anteriores. Estoque, Eventos, Solicitações, Reservas e Autenticação já estavam persistidos; a tela de Movimentações utilizava demonstrações. Os módulos existentes foram reutilizados e integrados ao controle físico.

A migração **`202610220005_movements`** é aditiva e foi aplicada no banco de uso e no banco isolado `unieventos_test`. As quatro migrações anteriores foram preservadas. Não houve reset, recriação do banco, seed ou importação de equipamentos, eventos ou movimentações fictícias para o banco de uso. O levantamento anterior à alteração está em `.local/review/stage6-before.json`, sem credenciais.

A conferência final comparou conteúdo e contagem das 17 tabelas existentes com o levantamento inicial e os checksums das quatro migrações anteriores: nenhuma alteração nos dados anteriores. Os cinco arquivos de migração correspondem aos checksums aplicados. As três novas tabelas de movimentação permanecem vazias no banco de uso. Resultado local em `.local/review/stage6-after.json`; os registros dos testes foram criados exclusivamente no banco isolado. A pasta fornecida não possui metadados `.git`, portanto não foi possível gerar `git status`/`git diff`; nenhum repositório foi inicializado ou reiniciado.

O modelo acrescenta `Equipment.lost`, o estado físico `LOST`, os dados operacionais e de autoria em `Withdrawal`, controle de perdas por retirada/unidade, `WithdrawalSettlement`, `WithdrawalSettlementUnit` e `MovementHistory`. Registros antigos continuam válidos com os valores padrão e campos opcionais; autoria, responsável ou destino ausentes não recebem identificação retroativa. Constraints protegem quantidades, regularização, total físico e resolução de cada patrimônio.

## Funcionalidades concluídas

- Movimentações reais em `/movimentacoes`, com indicadores, busca, paginação e filtros por evento, equipamento, responsável, período de retirada e situação. Situações: em uso, devolução parcial, atraso, concluída, com avaria e com extravio. Filtros de avaria/extravio também incluem ocorrências em movimentações parcialmente regularizadas.
- Retiradas vinculadas exclusivamente a reservas ativas originadas de solicitações aprovadas, para eventos válidos. O registro informa responsável operacional, destino, previsão de retorno, observações e checklist. Data/hora efetiva e autoria são obtidas pelo servidor.
- Várias retiradas parciais da mesma reserva, limitadas à quantidade ainda não retirada. A soma histórica de retiradas consome a quantidade aprovada uma única vez: devolver ou registrar extravio não autoriza retirar novamente o mesmo saldo.
- Seleção explícita dos patrimônios alocados à reserva. Um patrimônio em uso, manutenção, extraviado, já utilizado nessa reserva ou comprometido no intervalo não pode ser retirado.
- Conferências totais ou parciais, com quantidades recebidas em boas condições, devolvidas com avaria ou apuradas como extravio. Itens não conferidos continuam pendentes. Patrimônios exigem identificação e condição por unidade.
- Checklist obrigatório de quantidade/patrimônios, condição física e acessórios nas retiradas e conferências. Avarias e extravios exigem observações; validação no servidor independe da interface.
- Devoluções em boas condições voltam ao saldo físico; devoluções com avaria seguem para manutenção. Extravio não é devolução física: regulariza a pendência operacional, preserva o histórico e mantém a unidade indisponível.
- Detalhes em `/movimentacoes/[id]`, com responsável, destino, evento, equipamento, autoria autenticada, prazos, saldos, conferências, ocorrências e histórico. Eventos, equipamentos e reservas mostram suas movimentações vinculadas.
- Histórico de patrimônio em `/estoque/patrimonios/[id]`, reunindo eventos, retiradas, destinos, responsáveis, conferências e ocorrências, com links para os registros completos.
- Dashboard e notificações internas usam indicadores reais de utilização, atrasos, avarias e extravios. A busca global inclui movimentações reais, equipamentos, patrimônios, eventos e destinos. As telas funcionais não dependem de `DemoProvider`.
- Formulários responsivos, mensagens de validação e conflito, estados vazios, carregamento e recuperação de erros mantêm os componentes, cores e identidade institucional existentes.

## Políticas operacionais

### Períodos e atrasos

**Retirada antecipada é bloqueada.** A retirada deve ocorrer dentro do intervalo aprovado `[início, término)`. Quando for necessário retirar antes, o planejamento precisa ser revisto e aprovado antes da operação; não existe exceção por parâmetro enviado pelo navegador. Reservas vencidas também não autorizam novas retiradas.

A previsão inicial de devolução deve ser futura e não ultrapassar o término da reserva. Datas efetivas de retirada e conferência são registradas pelo servidor; sua apresentação utiliza `America/Sao_Paulo`, com instantes `timestamptz` no PostgreSQL.

Devolução após o prazo continua permitida e deve ser registrada normalmente. O atraso permanece visível enquanto houver saldo pendente; o relógio não devolve equipamentos nem libera disponibilidade automaticamente. **Toda retirada pendente bloqueia conservadoramente os intervalos futuros até sua regularização**, mesmo quando possui previsão de retorno.

Uma extensão de utilização exige simultaneamente `MOVEMENTS_WRITE` e `REQUEST_APPROVE`, justificativa e prazo futuro posterior ao atual. O servidor revalida a reserva/evento e a capacidade durante todo o intervalo, incluindo reservas futuras, patrimônios específicos e saldo ainda não retirado da própria reserva. Conflitos impedem a extensão. O novo prazo fica na utilização e no histórico; o período original aprovado da reserva não é reescrito.

### Saldos, avarias e extravios

A retirada reduz a quantidade ainda comprometida na reserva e aumenta o saldo em uso, sem desconto duplicado. Uma conferência reduz apenas o saldo pendente efetivamente regularizado. O total cadastrado é preservado; manutenção e perdas são parcelas indisponíveis distintas.

Para itens por quantidade, o saldo em uso é `retirada − devolvida − extraviada`. A disponibilidade considera total, manutenção, perdas, retiradas pendentes e a parcela das reservas que ainda não foi retirada. Patrimônios em manutenção ou `LOST` ficam fora da alocação.

Atrasos, avarias e perdas podem revelar que um compromisso anteriormente aprovado ficou sem capacidade física. A conferência registra esse fato sem esconder o inventário: o disponível é limitado a zero e o déficit aparece como `conflictQuantity`, com avisos para regularização. Não são criados saldos disponíveis negativos ou reservas adicionais para compensar o conflito.

Após reparo, ADMIN ou conta com `INVENTORY_WRITE` pode reduzir a manutenção pelo cadastro de estoque, com motivo, histórico e validação dos vínculos. **Não existe nesta etapa recuperação auditada de patrimônio extraviado.** O cadastro não permite remover, renomear, recuperar ou criar artificialmente uma unidade `LOST`; sua identificação e histórico são preservados.

### Cancelamento e arquivamento

Cancelamento de reserva e alteração de período, cancelamento, conclusão ou arquivamento de evento são bloqueados enquanto existirem retiradas pendentes, inclusive quando a reserva já venceu. É necessário conferir as devoluções ou apurar as ocorrências primeiro. Extravio integralmente registrado conta como regularização operacional, mantendo sua indisponibilidade física.

Equipamentos com reservas ativas, retiradas pendentes ou manutenção não podem ser arquivados. Após regularização e liberação dos compromissos, o arquivamento é lógico e conserva vínculos, movimentações e históricos. Não foram criadas rotas de exclusão de retiradas, conferências ou auditoria.

## Autorização, auditoria e concorrência

- Todos os três setores podem consultar estoque, agenda, disponibilidade e histórico de movimentações com sessão válida. Registrar retirada ou conferência exige ADMIN ou concessão explícita de `MOVEMENTS_WRITE` pela administração.
- A permissão de movimentação não concede alteração de estoque, aprovação de pedidos, cancelamento de reservas ou extensão por si só. A extensão exige também `REQUEST_APPROVE`; as políticas anteriores de pedidos próprios e reservas aprovadas permanecem em vigor.
- Cada entrada HTTP e serviço sensível valida autenticação/permissão no servidor. As transações consultam novamente conta, sessão e permissões persistidas e mantêm os bloqueios até o commit. Desativação ou revogação de privilégios impede operações subsequentes; cabeçalhos, setor, perfil e `userId` fornecidos pelo cliente não autorizam ações.
- Responsável operacional informado permanece separado do usuário autenticado que registrou o fato. A autoria real é persistida na retirada, conferências, `MovementHistory`, `StockHistory` e `AuditLog`, sem tokens, senhas ou hashes de credenciais em snapshots.
- Operações usam transações serializáveis, versões otimistas e bloqueios consistentes: conta/sessão, evento, solicitação, equipamento, reserva e retirada, conforme os vínculos. Equipamentos são bloqueados em ordem nas aprovações com vários itens. Conflitos de escrita reconhecidos no Prisma/adaptador PostgreSQL repetem a transação completa.
- Retirada, conferência, alteração de prazo, estoque e auditoria são atômicos. Duas retiradas ou devoluções simultâneas não podem consumir ou regularizar a mesma unidade duas vezes.
- Mantidas as proteções de sessão, cookies e CSRF da Etapa 5. Mutações exigem JSON e rejeitam origem divergente; identidades não são aceitas no corpo das movimentações.

## APIs e arquivos principais

| Área | Arquivos |
| --- | --- |
| Modelo | `prisma/schema.prisma`, `prisma/migrations/202610220005_movements/migration.sql` |
| Domínio e validação | `src/server/movements-service.ts`, `src/server/movements-http.ts`, `src/lib/movements-validation.ts`, `src/types/movements.ts` |
| Entradas HTTP | `src/app/api/movements/route.ts`, `src/app/api/movements/options/route.ts`, `src/app/api/movements/overview/route.ts`, `src/app/api/movements/[id]/route.ts`, `src/app/api/movements/[id]/settlements/route.ts`, `src/app/api/movements/[id]/extend/route.ts`, `src/app/api/equipment-units/[id]/history/route.ts` |
| Integração com estoque/reservas/eventos | `src/server/inventory-service.ts`, `src/server/requests-availability.ts`, `src/server/requests-service.ts`, `src/server/events-service.ts`, `src/lib/inventory-validation.ts`, `src/types/inventory.ts` |
| Permissão e estado compartilhado | `src/types/auth.ts`, `src/components/providers/auth-provider.tsx`, `src/components/providers/movements-provider.tsx` |
| Páginas | `src/app/movimentacoes/page.tsx`, `src/app/movimentacoes/layout.tsx`, `src/app/movimentacoes/[id]/page.tsx`, `src/app/estoque/patrimonios/[id]/page.tsx` |
| Componentes | `src/components/movements/withdrawal-form.tsx`, `settlement-form.tsx`, `movement-detail.tsx`, `movement-controls.tsx`, `movements-panel.tsx`, `asset-history.tsx` |
| Integrações visuais | `src/components/events/event-detail.tsx`, `src/components/inventory/equipment-detail.tsx`, `inventory-controls.tsx`, `equipment-form.tsx`, `src/app/estoque/page.tsx`, `src/components/requests/request-detail.tsx`, `reservations-panel.tsx`, `src/components/dashboard/dashboard.tsx`, `movements-summary.tsx`, `src/components/layout/app-shell.tsx` |
| Testes | `tests/movements.test.ts`, `tests/movements-stock.test.ts`, `tests/e2e/movements.spec.ts`, `tests/e2e/requests-surfaces.spec.ts`, `tests/e2e/ui.spec.ts`, `scripts/test-database.mjs` |
| Documentação | `README.md`, `docs/architecture.md`, este documento |

| Rota | Operação |
| --- | --- |
| `GET /api/movements` | Listagem, busca, filtros, indicadores e paginação |
| `POST /api/movements` | Registrar retirada autorizada |
| `GET /api/movements/options` | Reservas aprovadas no intervalo atual e com saldo não retirado |
| `GET /api/movements/overview` | Resumo e movimentações para Dashboard/busca |
| `GET /api/movements/[id]` | Detalhes, conferências, histórico e permissões atuais |
| `POST /api/movements/[id]/settlements` | Registrar devolução e/ou ocorrência parcial ou total |
| `POST /api/movements/[id]/extend` | Estender utilização após autorização e análise de conflitos |
| `GET /api/equipment-units/[id]/history` | Histórico integrado de um patrimônio |

## Verificações executadas

- `npm.cmd run lint`: aprovado, zero avisos.
- `npm.cmd run typecheck`: aprovado.
- `npm.cmd run build`: aprovado.
- Migração aditiva aplicada aos dois bancos, com preservação das quatro anteriores.
- `npm.cmd run test:integration`: **68 testes aprovados**, exclusivamente em `unieventos_test`. São 17 novos cenários da Etapa 6 e 51 regressões das etapas anteriores.
- Playwright/Chrome: **66 testes aprovados** em uma execução completa, com dois workers, incluindo desktop e celular emulado. São dez novos casos da Etapa 6 e 56 regressões anteriores.
- Inspeção visual dos detalhes de retirada em desktop e celular, sem transbordamento horizontal.
- Servidor de uso reiniciado em `http://127.0.0.1:3000`; login retorna HTTP 200, APIs de estoque/movimentações retornam HTTP 401 sem sessão. O servidor isolado de testes foi encerrado após a verificação.

Os testes novos de integração verificam retiradas e devoluções parciais, checklist e identidade não adulterável, horários, reserva/evento elegíveis, patrimônios exclusivos, ocorrências, saldo físico, concorrência de retiradas e conferências, extensão diante de reservas futuras e saldo ainda não retirado, permissões/revogação, cancelamentos, atrasos, persistência e consultas de histórico. Os cinco cenários de integração de estoque incluem déficit físico legível, perdas sem dupla contagem, proteção de `LOST`, consumo único da reserva individual e bloqueio de cancelamento/arquivamento após vencimento.

Os cinco novos testes de navegador são executados em desktop e celular emulado: retiradas parciais com checklist/persistência; conferências com avaria/extravio e filtros; patrimônio com histórico integrado; extensão com conflito futuro, persistência, atraso, notificação e cancelamento bloqueado até devolução; negação de acesso e separação entre movimentação e análise de reservas. Fixtures são criadas pelas APIs autenticadas e removidas por IDs próprios no banco isolado. Nenhum executor utiliza o banco de uso.

### Erros encontrados e corrigidos

- O lint detectou leitura de relógio durante renderização do formulário; o horário de referência passou a ser inicializado no estado, com validação efetiva mantida no servidor.
- A revisão reforçou a extensão para preservar o saldo ainda não retirado da própria reserva, sem recriar a quantidade já emitida; regressão de integração aprovada.
- Filtros de avaria/extravio passaram a incluir ocorrências em retiradas ainda parciais ou atrasadas; a busca do seletor passou a filtrar no PostgreSQL antes do limite de resultados.
- Dois testes antigos esperavam o texto anterior das notificações. Foram adaptados à presença de devoluções atrasadas, mantendo a verificação dos pedidos persistidos.
- O teste de reabertura da busca enviava `Ctrl+K` imediatamente após navegação completa, antes da montagem do layout. A espera pelo inventário carregado eliminou a corrida, sem aumentar timeouts ou ocultar falhas da aplicação.
- O aviso histórico de avaria passou a orientar a consulta da condição atual no estoque, preservando a distinção entre a ocorrência registrada e eventual reparo posterior.

Não restam falhas nas verificações executadas. O driver `pg` emite um aviso de depreciação sobre consultas simultâneas na mesma conexão transacional; a versão instalada executa essas consultas em fila e todos os testes de concorrência passaram. A compatibilidade deve ser reavaliada antes de atualizar para `pg` 9, que anuncia a remoção desse comportamento.

## Limitações e pendências

- Não há recuperação auditada de perdas, baixa patrimonial definitiva, anexos/fotos, assinatura de recebimento ou comprovante para impressão. Patrimônios extraviados permanecem imutáveis no cadastro até um fluxo específico futuro.
- A baixa de manutenção após reparo utiliza o CRUD autorizado de estoque, com motivo; não há ordem de serviço de manutenção ou agenda futura de reparos.
- A disponibilidade futura é conservadora: toda retirada pendente ocupa capacidade até regularização, independentemente da previsão de retorno. Estender prazo não garante que outros itens serão devolvidos ou reparados.
- A busca e os filtros de situação carregam as movimentações filtradas no servidor e depois calculam os estados derivados/paginação em memória. Grandes volumes exigirão otimização por consultas agregadas e paginação no banco. Históricos detalhados são retornados integralmente.
- O seletor de reservas possui limite de 1.000 registros por consulta e aviso para refinar a busca; o filtro textual é aplicado no banco antes desse limite. O resumo para busca global retorna até 1.000 movimentações com indicação de limite. A listagem própria continua consultável com filtros e paginação.
- As permissões reais precisam ser concedidas às contas operacionais pelo ADMIN; nenhum usuário, segredo ou credencial padrão foi criado nesta entrega. Permanecem os requisitos operacionais da Etapa 5 para HTTPS institucional, gestão de segredos e backup.
- Testes móveis usam emulação. Validar checklist e conferência com os setores, aparelhos físicos e tecnologias assistivas antes do uso institucional.

## Conferência operacional sugerida

1. Entrar como ADMIN, conferir equipamento e evento reais e aprovar uma solicitação para um intervalo que inclua a retirada.
2. Registrar uma retirada parcial com checklist e destino; repetir para parte do saldo aprovado. Conferir que reservado e em uso não são contabilizados duas vezes.
3. Registrar retorno parcial bom, avaria para manutenção e extravio com justificativa. Recarregar a página e conferir persistência, saldos separados e histórico autenticado.
4. Para equipamento individual, selecionar os patrimônios da reserva e consultar o histórico de cada unidade pelos detalhes de movimentação/estoque.
5. Conferir que usuários dos setores consultam os registros, mas precisam de `MOVEMENTS_WRITE` para operar; extensão exige também análise de reservas.
6. Verificar atraso, conflito com reserva futura e bloqueio de cancelamento/arquivamento enquanto houver pendência. Regularizar a retirada antes de liberar compromissos e arquivar os cadastros.
