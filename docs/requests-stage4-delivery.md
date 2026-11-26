# Entrega — Etapa 4: Solicitações e Reservas

## Estado inicial e preservação

Foram revisados `AGENTS.md`, schema Prisma, README, serviços, componentes, testes e documentos das Etapas 2 e 3 antes da implementação. Estoque e Eventos já eram persistidos; Solicitações ainda consumia demonstrações. A pasta não possui repositório Git, portanto `git status` não disponibiliza um diff de alterações. Nenhuma alteração local foi descartada.

A migração aditiva `202610210003_requests` cria o enum de status, as tabelas `EquipmentRequest`, `EquipmentRequestItem`, `RequestHistory`, índices, constraints e chaves estrangeiras. Adiciona somente `Reservation.requestItemId`, opcional e único, às tabelas anteriores. Reservas anteriores continuam válidas sem vínculo de solicitação. As migrações anteriores não foram reescritas. Não houve reset, seed ou sobrescrita de dados.

O banco de uso e o banco isolado `unieventos_test` receberam a migração por `prisma migrate deploy`. A conferência de contagens, hashes e checksums está em `.local/review/stage4-before.json` e `.local/review/stage4-integrity.json`, sem credenciais. Todos os testes gravam exclusivamente no banco isolado; os testes de integração removem apenas seus próprios IDs.

## Funcionalidades

- Criação e edição de rascunhos vinculados a eventos e equipamentos reais, com responsável declarado, intervalo necessário, quantidades e observações por item.
- Envio explícito para análise, sem bloquear estoque ou criar reserva. Somente rascunhos podem ser editados; versão evita sobrescritas.
- Lista real com busca normalizada, filtros de status, setor, evento e período; paginação de 6, 12 ou 24 registros.
- Detalhes com histórico de cadastro, importação, edição, envio e decisões; consulta de disponibilidade e reservas.
- Reaproveitamento explícito e idempotente de necessidades preliminares. O vínculo com a necessidade original é preservado enquanto ela existir, sem duplicar a tabela de necessidades ou reservar equipamentos.
- A importação repetida retorna a mesma solicitação, inclusive se posteriormente encerrada. Alterações nas necessidades não sobrescrevem o pedido importado; um novo pedido independente pode ser cadastrado manualmente. Remover uma necessidade não remove itens ou histórico já importados.
- Regras transacionais de aprovação, recusa justificada e cancelamento, preparadas para uma futura camada de autorização autenticada. Uma aprovação cria uma reserva por item e aloca patrimônios individuais reais.
- Disponibilidade por `[início, término)`: intervalos adjacentes não se sobrepõem; calcula-se o pico de reservas simultâneas, não a soma de compromissos em horários distintos. Pendências não consomem disponibilidade.
- Manutenção e retiradas ainda não devolvidas diminuem a capacidade. Retirada vinculada consome a reserva correspondente, sem dupla contagem; a parte já retirada e devolvida não volta a criar compromisso de reserva.
- Um patrimônio individual precisa estar livre em todo o período. Unidades em manutenção ou retiradas são excluídas; alocações individuais antigas incompletas bloqueiam conservadoramente a aprovação.
- Transações serializáveis e bloqueios na ordem evento → solicitação → equipamentos ordenados impedem sobreaprovação simultânea. Unicidade do vínculo item/reserva e controle de versão impedem reaprovação e duplicações. Conflitos do Prisma e do adaptador PostgreSQL repetem a transação completa com pequeno recuo.
- Cancelamento autorizado libera o compromisso de reserva, preserva registros e histórico; retirada ainda não devolvida impede cancelar a reserva. Reservar não retira fisicamente equipamentos.
- Reservas consultáveis nos detalhes do evento e do equipamento. Arquivamento de equipamentos com reservas ativas continua bloqueado. Eventos com reservas ativas não podem mudar de período, ser cancelados, encerrados ou arquivados sem liberar as reservas com autorização.
- Dashboard, badge da sidebar e central de notificações usam solicitações reais; os quatro indicadores existentes de estoque/eventos foram preservados. Movimentações permanece demonstração isolada.
- Formulários, filtros e apresentação usam `America/Sao_Paulo`; o banco armazena instantes `timestamptz` e a API retorna UTC.

## Segurança e pendência de autenticação

**Aprovação, recusa e cancelamento permanecem indisponíveis na aplicação.** O autorizador padrão do servidor nega essas decisões com HTTP 403, independentemente do setor declarado, de botões, parâmetros, cabeçalhos ou identidade enviada pelo cliente. O endpoint não aceita um autorizador, papel ou flag de habilitação.

`createRequestDecisionService` recebe uma dependência de autorização exclusivamente de código confiável do servidor. Ela deve fornecer uma identidade de sessão validada e as permissões `REQUEST_APPROVE`, `REQUEST_REFUSE`, `RESERVATION_CANCEL`. A instância usada pelos endpoints é fixa e nega por padrão. Os testes de integração injetam identidades autorizadas no próprio processo de teste para exercitar transações; isso não cria uma rota ou configuração de contorno na aplicação.

Responsável e setor são declarados, não usuários verificados. Cadastros, alterações de rascunhos e envio público para análise não comprovam autoria nem propriedade. `createdByUserId` permanece nulo; histórico de decisões só registra `actorUserId` fornecido pelo autorizador confiável. Para habilitar decisões em produção, é necessário implementar autenticação, vincular permissões a contas e revisar o controle de acesso de criação, edição e leitura.

## Arquivos criados e alterados

| Área | Arquivos |
| --- | --- |
| Modelo | `prisma/schema.prisma`, `prisma/migrations/202610210003_requests/migration.sql` |
| Contratos/validação/cliente | `src/types/requests.ts`, `src/lib/requests-validation.ts`, `src/lib/requests-client.ts` |
| Domínio | `src/server/requests-service.ts`, `src/server/requests-availability.ts`, `src/server/requests-permissions.ts`, `src/server/requests-http.ts`, `src/server/transaction-conflict.ts` |
| APIs | `src/app/api/requests/route.ts`, `[id]/route.ts`, `[id]/submit/route.ts`, `[id]/decision/route.ts`, `overview/route.ts`, `availability/route.ts`, `import-needs/route.ts`, `src/app/api/reservations/route.ts` |
| Interface | `src/app/solicitacoes/page.tsx`, `src/app/solicitacoes/[id]/page.tsx`, `src/components/requests/request-form.tsx`, `request-detail.tsx`, `availability-notice.tsx`, `reservations-panel.tsx` |
| Estado e integrações | `src/components/providers/requests-provider.tsx`, `demo-provider.tsx`, `src/app/layout.tsx`, `src/components/layout/app-shell.tsx`, `src/components/dashboard/dashboard.tsx`, `src/components/dashboard/requests-summary.tsx`, `src/components/events/event-detail.tsx`, `src/components/inventory/equipment-detail.tsx`, `src/lib/mock-data.ts` |
| Proteções existentes | `src/server/events-service.ts` (reservas ativas e repetição de transações), `src/server/inventory-service.ts` (repetição de conflitos do adaptador) |
| Testes e documentação | `scripts/test-database.mjs`, `tests/requests.test.ts`, `tests/e2e/requests.spec.ts`, `tests/e2e/requests-surfaces.spec.ts`, `README.md`, este documento |

## Verificações

- `npm.cmd run lint`: aprovado, zero avisos.
- `npm.cmd run typecheck`: aprovado.
- `npm.cmd run build`: aprovado, incluindo as novas rotas de API, lista e detalhes de solicitações.
- Migrações aplicadas nos dois bancos sem reset; os três checksums registrados no PostgreSQL coincidem com os arquivos.
- `npm.cmd run test:integration`: **33 testes aprovados** (17 solicitações, 9 estoque, 7 eventos), exclusivamente em `unieventos_test`.
- Playwright/Chrome: **40 execuções aprovadas**, desktop e celular emulado (10 solicitações/integrações visuais, 12 eventos, 10 estoque, 8 regressões gerais).
- Após o último ajuste de navegação por parâmetros, o build foi repetido e os 10 testes de solicitações/integrações visuais passaram novamente sobre essa versão. Inspeção visual local confirmou a identidade atual e ausência de rolagem horizontal em 1440×1000 e 393×851.
- Casos de solicitações cobrem importação concorrente idempotente, persistência, histórico, filtros, ausência de reserva ao enviar, pico simultâneo, adjacência, manutenção, retirada sem devolução, patrimônio individual livre em todo o período, concorrência entre eventos diferentes, atomicidade de múltiplos itens, cancelamento/liberação, proteções de arquivamento/evento, constraints e permissões.
- No navegador, os testes também enviam decisões diretamente por HTTP com identidade/permissões forjadas e recebem 403. A verificação não depende de botões desabilitados.
- Contagens/hashes das dez tabelas anteriores do banco de uso permaneceram iguais; a projeção de `Reservation` desconsidera somente a nova coluna opcional. O banco de uso estava vazio e permaneceu vazio; nenhuma fixture foi importada para ele.

Erros encontrados e corrigidos: conflitos serializáveis podiam ser devolvidos pelo adaptador `pg` como `TransactionWriteConflict`/SQLSTATE 40001 na conclusão da transação, além de P2034; o tratamento agora reconhece essas causas e repete a transação completa. A página de solicitações recebeu `Suspense` para uso de parâmetros de busca no build. A consulta de histórico foi preservada mesmo após arquivar um equipamento, apresentando disponibilidade zero e aviso em vez de tornar o pedido inacessível. Para pedidos aprovados, a interface exibe as próprias reservas sem classificá-las como conflito de uma nova solicitação.

O executor `tsx` apresentou `uv_os_get_passwd ENOMEM` sob a restrição do terminal Windows; a suíte foi executada fora dessa restrição, mantendo a conexão exclusivamente no banco isolado. Execuções simultâneas independentes do Playwright disputaram a pasta de evidências e causaram ENOENT; o resultado final acima foi obtido com um único executor. O driver `pg` ainda emite um aviso de depreciação em consultas internas do adaptador Prisma; não houve falha de teste, TypeScript ou lint decorrente desse aviso.

## Limitações conhecidas

- Decisões sensíveis exigem a implementação futura de autenticação real e associação de permissões. Nenhuma reserva é criada automaticamente por cadastro, envio, importação ou necessidade de evento.
- Não há novos fluxos de retirada ou devolução; os vínculos existentes são considerados no cálculo de disponibilidade.
- O período pertence à solicitação e se aplica a todos os itens. Para períodos distintos, use solicitações separadas.
- Retiradas sem previsão confiável de retorno ocupam conservadoramente todo o intervalo consultado até devolução. Não há calendário de manutenção futuro: a manutenção física atual é considerada indisponível em todo o período.
- Consultas de disponibilidade são informativas, sem garantia de saldo futuro; a aprovação revalida tudo dentro da transação. Para pedidos aprovados, a interface mostra seus compromissos de reserva em vez de apresentar a própria reserva como um novo conflito de disponibilidade.
- Calendário e seletores mantêm o limite de 2.000 resultados com aviso para refinar a busca. Históricos de solicitações e reservas vinculadas ainda são retornados integralmente.
- Validar as nomenclaturas e a operação com os setores, além de aparelhos móveis reais e tecnologias assistivas; testes móveis usam emulação.

## Conferência funcional pelos setores

1. Cadastrar equipamentos e um evento reais; informar necessidades preliminares no evento.
2. Abrir as solicitações pelo evento e importar as necessidades duas vezes: deve abrir o mesmo rascunho, sem duplicar necessidades ou alterar saldos.
3. Editar quantidades/período, consultar disponibilidade, salvar, recarregar e enviar para análise. Confirmar persistência, histórico e atualização de indicadores/notificações.
4. Confirmar que a pendência não cria reservas e que os três botões sensíveis permanecem indisponíveis com a explicação de autorização necessária.
5. Após implementar autenticação real, validar aprovação, recusa e cancelamento por contas autorizadas; testar também a negação por contas sem permissão. Nesta etapa, esses cenários são verificados automaticamente no domínio e a negação pública é testada por HTTP.
