# UniEventos

Gestão integrada de eventos e equipamentos do **UniSALESIANO**, para Multimeios, Marketing e Projeto de Extensão.

## Estado atual

As etapas 2 a 6 implementam **Estoque, Eventos, Solicitações, Reservas, Movimentações e controle de acesso com PostgreSQL e Prisma**. As operações exigem contas previamente autorizadas. Não são importados equipamentos, eventos, movimentações ou usuários fictícios no banco de uso.

Os módulos, indicadores e notificações usam dados reais. Aprovação, recusa, cancelamento de reservas, retiradas e conferências estão habilitados para contas com as permissões correspondentes, verificadas no servidor e na transação. As telas funcionais não utilizam `DemoProvider`.

## Executar localmente

Requisitos: Node.js **20.19+** (ou 22.12+/24+) e npm. Recomenda-se Node.js LTS. No PowerShell que bloqueia scripts, use `npm.cmd`/`npx.cmd`.

```powershell
cd E:\Uni\unieventos
npm.cmd install
npm.cmd run db:setup
npm.cmd run db:migrate
npm.cmd run auth:setup
npm.cmd run admin:bootstrap
npm.cmd run dev
```

Acesse **http://127.0.0.1:3000/login**. O bootstrap é executado somente na primeira instalação e solicita nome, e-mail `@unisalesiano.com.br` e senha oculta em terminal interativo; não existe senha padrão. `auth:setup` gera um segredo exclusivo no `.env` sem exibi-lo e preserva um segredo válido existente. O comando `db:setup` inicializa PostgreSQL local com credenciais geradas e bancos separados para desenvolvimento e testes. Não instala Docker nem serviço do Windows. Em execuções posteriores, use `npm.cmd run db:start` se o banco estiver parado, seguido de `npm.cmd run dev`.

Os binários PostgreSQL são fornecidos por `embedded-postgres` (wrapper beta, binários PostgreSQL 18.4); o helper usa os executáveis nativos. O banco escuta apenas em `127.0.0.1:55432`. Os dados ficam em **`.local/postgres/data`**, fora do Git, e persistem após reiniciar a aplicação ou o banco. Credenciais são geradas em `.local/postgres/config.json` e `.env`; não publique esses arquivos. O usuário da aplicação não é superusuário. Excluir `.local` elimina os dados locais, portanto preserve essa pasta ou faça backup antes de reinstalar o ambiente.

```powershell
npm.cmd run db:status
npm.cmd run db:stop
npm.cmd run db:start
```

Para usar PostgreSQL existente, configure `DATABASE_URL` e `TEST_DATABASE_URL` no `.env`, tomando `.env.example` como referência. O banco de testes deve se chamar `unieventos_test` e ser separado do banco da aplicação. Nesse caso não execute o helper de PostgreSQL local: execute somente geração do cliente e migrações na conexão pretendida. O helper preserva um `.env` que já aponta para outro banco.

## Eventos e agenda compartilhada

Acesse **http://127.0.0.1:3000/eventos**.

- CRUD com título, descrição, setor organizador, responsável declarado, contato, local, tipo, início, término e status.
- Agenda mensal, semanal e listagem paginada, compartilhada entre os três setores, com busca e filtros de setor, período, tipo, status e local.
- Detalhes em `/eventos/[id]`, histórico de alterações e compatibilidade com os links anteriores `/eventos?item=ID`.
- Cancelamento e arquivamento com motivo preservam os registros, o histórico e as necessidades de equipamentos. Edições usam versão para evitar sobrescritas.
- Necessidades vinculadas aos equipamentos reais, com quantidade e observações, identificadas como **solicitações preliminares**. Podem exceder o saldo atual porque ainda serão avaliadas; não reservam, retiram ou alteram o inventário.
- Avisos informativos de sobreposição em local e horário coincidentes, considerando somente eventos não cancelados/não arquivados. Locais diferentes e intervalos adjacentes não geram esse alerta; o aviso não impede salvar.
- Horários de formulário e apresentação usam `America/Sao_Paulo`, independentemente do dispositivo. Instantes são gravados em `timestamptz`, retornados em UTC e convertidos explicitamente com Temporal. Horários inexistentes ou ambíguos em transições de fuso são rejeitados no formulário.
- Eventos de vários dias aparecem em todos os dias abrangidos, usando intervalos `[início, término)`; um término exato à meia-noite não ocupa o dia seguinte.

Eventos novos registram a conta autenticada autora e o usuário responsável por cada alteração. O contato operacional informado no formulário continua separado da autoria autenticada. Registros anteriores preservam a autoria nula; o sistema não atribui retroativamente esses registros a uma conta.

Após atualizar o código, execute `npm.cmd run db:generate` e `npm.cmd run db:migrate`, e reinicie o servidor de desenvolvimento para carregar o cliente Prisma atualizado. A migração da etapa 3 é aditiva; a migração original e os dados de estoque são preservados. Não execute reset ou seed sobre o banco de uso.

O calendário e o seletor de equipamentos limitam cada consulta a 2.000 resultados, com aviso para refinar a busca/período. O Dashboard utiliza dados reais de estoque, eventos, solicitações e movimentações.

## Solicitações e reservas

Acesse **http://127.0.0.1:3000/solicitacoes**.

- Cadastre rascunhos vinculados a eventos e equipamentos reais, com responsável declarado, quantidade, observações e período necessário em America/Sao_Paulo.
- Edite o rascunho e envie para análise. Solicitações pendentes não bloqueiam disponibilidade. A lista permite busca, filtros e paginação.
- Reaproveite as necessidades preliminares do evento por ação explícita. A importação é idempotente: retorna a solicitação já importada nas próximas tentativas, sem duplicar necessidades ou criar reservas. Mudanças posteriores nas necessidades não sobrescrevem a solicitação importada.
- Consulte disponibilidade por intervalo, histórico e reservas nos detalhes da solicitação, do evento e do equipamento. Reservas futuras não reduzem o saldo físico disponível agora.
- A disponibilidade considera o pico de reservas simultâneas, manutenção, perdas e retiradas sem regularização. Patrimônios individuais precisam estar livres durante todo o intervalo. Intervalos adjacentes podem reutilizar o mesmo patrimônio após seu retorno.
- A aprovação transacional e o cancelamento estão implementados no domínio, com bloqueios de linha, isolamento serializável, controle de versão e histórico. A reserva não cria retirada física nem altera a quantidade total. Equipamento com reserva ativa não pode ser arquivado; eventos com reservas ativas não podem ter o período alterado, ser encerrados, cancelados ou arquivados sem liberar as reservas com autorização.

**Autorização:** contas dos setores gerenciam seus próprios eventos e pedidos. Pedido próprio em rascunho ou pendente pode ser cancelado sem permissão de reserva. Após aprovação, cancelar exige `RESERVATION_CANCEL`, inclusive para o próprio autor. Análise exige `REQUEST_APPROVE` ou `REQUEST_REFUSE`. Nenhuma identidade ou permissão enviada pelo navegador substitui a sessão validada no PostgreSQL; solicitações alheias exigem acesso adicional explícito. Mesmo o autorizador interno de testes exige sessão real correspondente.

Não há retirada, devolução ou aprovação automática. O período é definido por solicitação e vale para todos os seus itens; use solicitações distintas para períodos diferentes. Toda retirada pendente bloqueia conservadoramente os intervalos futuros até ser devolvida ou ter sua ocorrência regularizada, mesmo quando possui previsão de retorno. Cancelar reserva ou encerrar/arquivar evento com retirada pendente é bloqueado, inclusive após o vencimento da reserva.

## Movimentações de equipamentos

Acesse **http://127.0.0.1:3000/movimentacoes**.

- Registre retiradas totais ou parciais vinculadas a reservas aprovadas, selecionando patrimônios individuais quando aplicável. Informe responsável operacional, destino, observações e previsão de retorno; o servidor registra a conta autenticada e o horário efetivo.
- Confira quantidades/patrimônios, condição física e acessórios no checklist obrigatório de retirada e devolução. A soma das retiradas não pode superar a quantidade aprovada; devolver não renova o saldo da mesma reserva.
- Registre conferências parciais ou totais, diferenciando itens devolvidos em boas condições, devolvidos com avaria para manutenção e extravios. Avarias/extravios exigem observações. Perdas permanecem fora do disponível e não reduzem o total histórico cadastrado.
- Consulte equipamentos em uso, pendências, atrasos, avarias e extravios com busca, filtros e paginação. Detalhes mostram conferências e histórico autenticado; eventos, solicitações, reservas e equipamentos exibem as movimentações vinculadas.
- Consulte o histórico integrado de cada patrimônio em `/estoque/patrimonios/[id]`, com eventos, responsáveis, destinos, devoluções e ocorrências. Dashboard, busca global e notificações incluem as movimentações reais.

ADMIN ou conta com `MOVEMENTS_WRITE` pode registrar retiradas e conferências; os três setores podem consultar os registros. A permissão é verificada novamente no banco dentro de cada transação. O responsável operacional informado não é apresentado como autor autenticado do registro.

**Retirada antecipada ou após o término da reserva é bloqueada.** A previsão inicial de retorno deve ser futura e respeitar o intervalo aprovado. Devoluções atrasadas continuam permitidas e não liberam capacidade automaticamente pelo relógio. Estender a utilização exige `MOVEMENTS_WRITE` **e** `REQUEST_APPROVE`, justificativa e nova análise dos conflitos futuros; o novo prazo fica na movimentação e o período original da reserva permanece preservado.

Após reparo, manutenção pode ser ajustada no CRUD autorizado de estoque, com motivo e histórico. Não há recuperação auditada de extravios nesta etapa; o cadastro preserva a identificação e o estado de patrimônios `LOST`. Retiradas, conferências e históricos não possuem exclusão pela aplicação.

Listagens calculam estados derivados e paginação em memória após os filtros do servidor; grandes volumes exigirão otimização. O seletor de reservas e o resumo para busca global limitam a 1.000 registros, com indicação de limite. Veja políticas, arquivos, testes e limitações na [entrega da Etapa 6](docs/movements-stage6-delivery.md).

## Estoque

- Busca por nome, descrição, categoria, local e patrimônio, com normalização de acentos.
- Filtros de categoria, disponibilidade, modo de controle e ativos/arquivados; paginação de 6, 12 ou 24 registros.
- Cadastro e edição de nome, categoria, descrição, local, quantidade e manutenção.
- Controle por **quantidade** ou por **unidades individuais com patrimônio único**; no segundo, o total resulta das unidades cadastradas.
- Detalhes em diálogo e em `/estoque/[id]`, com histórico paginado, saldos e unidades patrimoniais. Os links anteriores `/estoque?item=ID` continuam funcionando.
- Validações no cliente, no servidor e constraints no PostgreSQL; erros e confirmações em português.
- Alterações com motivo obrigatório, histórico atômico e controle de versão para evitar sobrescrita por outra edição.
- Exclusão lógica por arquivamento, preservando histórico. Reservas ativas, retiradas sem regularização ou unidades em manutenção bloqueiam a operação.

Quantidade total e manutenção podem ser ajustadas com motivo e autorização; os saldos reservado, em uso e extraviado resultam dos respectivos vínculos. Uma retirada consome a reserva correspondente, sem descontar duas vezes. Devoluções boas liberam somente a quantidade conferida; avarias vão para manutenção e perdas continuam indisponíveis. Quando atraso ou ocorrência compromete uma promessa existente, o estoque permanece consultável com saldo disponível zero e déficit explícito.

Reservas usam intervalos `[início, término)`, incluindo cálculo do pico de sobreposição e proteção de capacidade. Aprovação, retirada, conferência e extensão revalidam os vínculos, a sessão e as permissões em transações protegidas contra concorrência. Os históricos são preservados após arquivamento.

## Autenticação e permissões

Auth.js está fixado em `5.0.0-beta.32`, compatível com Next.js 16 e React 19. Login por credenciais exige uma conta ativa previamente cadastrada; possuir e-mail institucional **não** cria uma conta nem concede acesso. O domínio aceito é exatamente `unisalesiano.com.br`, sem subdomínios ou domínios semelhantes.

| Perfil | Acesso padrão |
| --- | --- |
| ADMIN | Administração de usuários, estoque, eventos, pedidos, decisões de reservas e movimentações |
| MULTIMEIOS | Consulta do estoque/agenda compartilhados e gestão dos próprios eventos/pedidos |
| MARKETING | Consulta do estoque/agenda compartilhados e gestão dos próprios eventos/pedidos |
| EXTENSAO | Consulta do estoque/agenda compartilhados e gestão dos próprios eventos/pedidos |

Em **Usuários e permissões**, ADMIN cadastra, edita, desativa, redefine senhas e concede permissões adicionais, incluindo `MOVEMENTS_WRITE` para retiradas e conferências. Essa concessão isolada não autoriza análise de reservas, extensão de utilização ou alteração do estoque. Administração de contas continua exclusiva de ADMIN. Alterações no próprio perfil, status e permissões são bloqueadas; é necessário manter ao menos um administrador ativo. Não existe cadastro público.

Senhas usam scrypt com sal aleatório. A sessão opaca fica dentro do JWT criptografado do Auth.js; no PostgreSQL fica apenas o hash do token. A expiração absoluta é de oito horas. Logout e alterações de e-mail, senha, perfil, status ou permissões revogam sessões anteriores. Cada operação consulta o estado atual no banco; decisões de reserva também revalidam e bloqueiam conta/sessão dentro da transação.

Cookies são HttpOnly e SameSite=Lax; Secure é obrigatório em HTTPS, com exceção explícita de HTTP local. Configure `AUTH_URL` com a origem institucional HTTPS no deploy e guarde `AUTH_SECRET` em um gerenciador de segredos. A aplicação recusa segredo ausente, curto ou de exemplo. `AUTH_EMAIL_DOMAINS` pode restringir, mas não ampliar o domínio confirmado. Não publique `.env`, arquivos locais do banco, senhas, tokens ou resultados de testes.

O limite de login é persistido: cinco tentativas por conta em quinze minutos, com um limite global adicional. Mensagens não distinguem conta inexistente, desativada ou credencial incorreta. Auth.js protege login/logout contra CSRF; APIs de mutação exigem JSON e rejeitam origem divergente e requisições marcadas como cross-site.

## Estrutura

```text
prisma/                         # Schema e migração PostgreSQL versionada
scripts/                        # Ciclo do PostgreSQL local e isolamento dos testes
src/
  app/api/equipment/            # Consulta, cadastro, edição, arquivamento e resumo
  app/api/requests/             # Solicitações, importação, disponibilidade e decisões protegidas
  app/api/reservations/         # Reservas por evento ou equipamento
  app/api/movements/            # Retiradas, conferências, extensão e consultas
  app/api/equipment-units/      # Histórico integrado por patrimônio
  app/estoque/[id]/              # Página de detalhes
  app/estoque/patrimonios/[id]/  # Rastreabilidade do patrimônio
  app/movimentacoes/            # Listagem e detalhes das movimentações
  components/inventory/         # Formulários, saldos, paginação e histórico
  components/requests/          # Solicitações, disponibilidade e consultas de reservas
  components/movements/         # Retiradas, conferências, checklist e histórico
  components/providers/         # Sessão e estado persistido compartilhado
  components/dashboard/         # Dashboard institucional e calendário
  components/layout/            # Sidebar, cabeçalho, busca e navegação móvel
  components/shared/            # Componentes administrativos reutilizados
  components/ui/                # Primitives shadcn/ui
  lib/                          # Validações, clientes HTTP e formatação
  server/                       # Prisma, autenticação e regras transacionais
  types/                        # Contratos persistidos dos módulos
```

O layout, as cores, a tipografia, a sidebar e os componentes shadcn/ui da primeira etapa foram mantidos. O cliente Prisma gerado fica ignorado em `src/generated/prisma` e é recriado por `npm install`/`npm run db:generate`.

## Verificações

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run db:test:migrate
npm.cmd run test:integration
npx.cmd playwright install chromium
npm.cmd run test:e2e -- --workers=2
```

Os testes de integração e navegador escrevem exclusivamente em `unieventos_test`. Nunca apontam para o inventário de uso. Os testes de navegador iniciam um servidor na porta 3100 com a conexão isolada. É possível usar Chrome/Edge já instalado: `$env:PLAYWRIGHT_CHANNEL = 'chrome'` ou `'msedge'`.

Em ambientes Windows que restringem a finalização da árvore de processos pelo Playwright, inicie o servidor de testes em um terminal com `node scripts/test-database.mjs server`; no segundo terminal defina `$env:PLAYWRIGHT_REUSE_TEST_SERVER = '1'` e execute os testes. Esse reaproveitamento só deve ser habilitado para esse servidor de teste iniciado explicitamente.

Veja [Etapa 6 — Movimentações](docs/movements-stage6-delivery.md), [Etapa 5 — Autenticação](docs/auth-stage5-delivery.md), [Etapa 4 — Solicitações](docs/requests-stage4-delivery.md), [Etapa 3 — Eventos](docs/events-stage3-delivery.md), [Testes de Eventos](docs/events-stage3-testing.md), [Verificação da etapa 2](docs/stock-stage2-testing.md), [Arquitetura](docs/architecture.md) e [Entrega da etapa 2](docs/stock-stage2-delivery.md). Documentos de etapas anteriores registram o estado na data daquela entrega.

Referências: [Next.js](https://nextjs.org/docs/app/getting-started/installation), [shadcn/ui](https://ui.shadcn.com/docs/installation/manual), [Prisma/PostgreSQL](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql) e [binários PostgreSQL locais](https://github.com/leinelissen/embedded-postgres).
