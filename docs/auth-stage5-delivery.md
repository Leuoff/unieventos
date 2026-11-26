# Entrega — Etapa 5: autenticação e controle de acesso

## Retomada e preservação

Na retomada foram examinados o schema, os serviços e APIs, Auth.js, telas de login/usuários, scripts, testes e entregas anteriores. A pasta não contém `.git`; `git status` e `git diff` foram tentados e não puderam fornecer histórico. Nenhum reset, checkout, descarte de arquivos, seed ou recriação do banco foi executado.

A interrupção havia deixado Auth.js instalado, modelos de autenticação, login, administração de contas e boa parte dos controles de autorização. Faltavam concluir a interface, conferir domínio também na sessão, adaptar regressões e executar testes reais. Esses arquivos foram aproveitados.

A migração aditiva `202610210004_auth` cria `UserRole`, `User`, `AppSession`, `LoginThrottle`, `AuditLog`, seus índices e vínculos, e acrescenta `StockHistory.actorUserId` opcional. As três migrações anteriores e os registros de estoque/eventos/pedidos foram preservados. Não foi atribuída autoria retroativa a registros históricos. Os campos de autoria existentes são mantidos, inclusive identificações históricas anteriores sem conta correspondente.

As conferências de contagem/hash e checksums estão em `.local/review/stage5-resume-before.json` e `.local/review/stage5-integrity.json`, sem credenciais. As verificações de autenticação usam exclusivamente `unieventos_test`; usuários de teste não são criados no banco de uso.

## Funcionalidades entregues

- Login/logout reais com Auth.js `5.0.0-beta.32`, compatível com Next.js 16 e React 19; versão fixada no lockfile.
- Acesso somente a conta previamente cadastrada, ativa e com senha correta. E-mail do domínio exato `unisalesiano.com.br` é condição necessária, sem constituir autorização por si só. Contas persistidas manualmente com domínio externo também são rejeitadas no login e na sessão.
- Senhas com scrypt N=32768, r=8, p=1, sal aleatório de 16 bytes e comparação em tempo constante. Comprimento aceito de 12 a 128 caracteres no cadastro/redefinição.
- Token de sessão aleatório de 32 bytes dentro do JWT criptografado do Auth.js. No PostgreSQL fica apenas SHA-256 do token. Prazo absoluto de oito horas, sem prorrogar o compromisso no banco quando o cookie é renovado.
- Consulta ao banco para validar conta ativa, domínio, sessão, expiração, versão de autorização e permissões atuais. Logout revoga a sessão persistida; trocar e-mail, senha, perfil, status ou permissões revoga todas as sessões anteriores da conta. Reativação exige novo login.
- Cookies HttpOnly, SameSite=Lax e Secure em HTTPS. HTTP sem Secure é aceito somente em origem local explicitamente configurada. Segredo ausente, curto ou de exemplo impede inicialização.
- Limitação persistida de cinco tentativas por conta em quinze minutos e limite global de mil tentativas por janela. Contas inexistentes, desativadas e credenciais inválidas recebem mensagem genérica.
- ADMIN administra usuários, modifica estoque e analisa reservas. Os três setores consultam estoque/agenda e gerenciam seus próprios eventos/pedidos. A administração pode conceder acesso adicional explícito, sem delegar administração de contas por uma permissão isolada.
- Tela administrativa com nome, e-mail, perfil/setor, ativo/inativo, senha inicial/redefinição, permissões, busca e paginação. Usuários não alteram o próprio perfil, status ou privilégios. As transações protegem a existência de administrador ativo.
- Proteção de páginas por Proxy e autorização independente nos serviços/Route Handlers. Cabeçalhos, setor, papel, `userId` ou atualizações de sessão enviados pelo navegador não concedem acesso.
- Agenda continua compartilhada. Alterar evento alheio exige `EVENT_MANAGE_ALL`; solicitações e seus detalhes são limitados por proprietário ou permissões reais de análise/gestão.
- Pedido próprio em rascunho ou pendente pode ser cancelado pelo autor/gestor, sem compromisso de estoque. Reserva aprovada exige `RESERVATION_CANCEL`, inclusive para o autor. Aprovar e recusar exigem permissões específicas.
- Aprovações revalidam sessão, conta, permissões, saldo e conflitos dentro da mesma transação. Bloqueios de conta/sessão são mantidos até o commit; preservados os bloqueios ordenados de evento, pedido e equipamentos e os retries serializáveis.
- Auditoria de login, logout e administração de usuários; autoria autenticada no histórico de estoque, eventos, solicitações e decisões. Password/hash/token não fazem parte das respostas administrativas nem snapshots de auditoria.
- Cabeçalho com conta real/logout, menus e ações conforme permissões, acesso negado, sessão expirada e falha recuperável de verificação. Responsável operacional informado continua separado da conta autora.
- Não há cadastro público nem criação automática de contas. Não foram criados fluxos automáticos de retirada/devolução ou reservas sem aprovação.

Auth.js Credentials exige estratégia JWT. A implementação usa esse mecanismo para o cookie e mantém sua sessão opaca revogável no banco existente, sem adaptar artificialmente Credentials à estratégia de sessão de banco do PrismaAdapter. Referência: [documentação oficial do provider](https://authjs.dev/reference/core/providers/credentials).

## Matriz de acesso padrão

| Operação | ADMIN | MULTIMEIOS / MARKETING / EXTENSAO |
| --- | --- | --- |
| Consultar estoque, disponibilidade e agenda | Sim | Sim |
| Cadastrar/editar/arquivar equipamentos | Sim | Somente com `INVENTORY_WRITE` adicional |
| Criar e gerenciar os próprios eventos/pedidos | Sim | Sim; setor derivado da conta |
| Gerenciar evento de outra conta | Sim | Somente com `EVENT_MANAGE_ALL` |
| Gerenciar pedido de outra conta | Sim | Somente com `REQUEST_MANAGE_ALL` |
| Aprovar / recusar pedidos | Sim | Somente com `REQUEST_APPROVE` / `REQUEST_REFUSE` |
| Cancelar pedido próprio sem reserva | Sim | Sim |
| Cancelar reserva aprovada | Sim | Somente com `RESERVATION_CANCEL` |
| Administrar usuários | Sim | Não |

Registros anteriores com autoria nula permanecem consultáveis no contexto permitido; sua gestão exige permissão de gerenciamento, sem adoção automática por um usuário do setor.

## Criar o primeiro administrador com segurança

Em um terminal PowerShell interativo, dentro de `E:\Uni\unieventos`:

```powershell
npm.cmd run db:start
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run auth:setup
npm.cmd run admin:bootstrap
npm.cmd run dev
```

Em uma primeira instalação sem PostgreSQL local configurado, execute `npm.cmd run db:setup` no lugar de `db:start`. Para PostgreSQL institucional existente, configure as conexões apropriadas e não inicialize outro banco com o helper local.

`auth:setup` escreve um segredo aleatório no `.env` sem imprimi-lo e preserva um segredo válido existente. Configure `AUTH_URL` como a origem correta; na implantação institucional use HTTPS e um gerenciador de segredos. Não copie o segredo para documentação, commits ou conversas.

O bootstrap solicita nome, e-mail institucional e senha duas vezes com entrada oculta. Use uma senha longa e exclusiva; não há senha padrão nem argumento de linha de comando para fornecê-la. O procedimento é permitido somente enquanto não existir nenhuma conta, com bloqueio transacional contra dois bootstraps simultâneos. Não há endpoint HTTP de bootstrap. Execute-o apenas no servidor/ambiente administrativo confiável.

Depois acesse [login local](http://127.0.0.1:3000/login) e use **Usuários e permissões** para cadastrar as demais contas. Entregue senhas iniciais por canal seguro. Reinicie o servidor após geração do Prisma ou alterações de configuração. O primeiro administrador do banco de uso não foi criado automaticamente durante a entrega.

## Arquivos criados ou alterados

| Área | Arquivos principais |
| --- | --- |
| Dependências/modelo | `package.json`, `package-lock.json`, `prisma/schema.prisma`, `prisma/migrations/202610210004_auth/migration.sql`, `.env.example` |
| Autenticação | `src/auth.ts`, `src/types/auth.ts`, `src/types/next-auth.d.ts`, `src/server/auth-core.ts`, `src/server/auth-context.ts`, `src/lib/auth-validation.ts`, `src/lib/auth-client.ts` |
| Administração | `src/server/users-service.ts`, `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts`, `src/app/usuarios/page.tsx` |
| Sessão e páginas | `src/app/api/auth/[...nextauth]/route.ts`, `src/app/api/auth/me/route.ts`, `src/app/login/page.tsx`, `src/app/acesso-negado/page.tsx`, `src/proxy.ts`, `src/app/layout.tsx`, `src/components/providers/auth-provider.tsx` |
| Operação segura | `scripts/configure-auth.mjs`, `scripts/bootstrap-admin.ts`, `scripts/test-database.mjs` |
| Autorização/auditoria dos módulos | `src/server/inventory-service.ts`, `events-service.ts`, `requests-service.ts`, `requests-permissions.ts`, `inventory-http.ts`, handlers de estoque/eventos/pedidos/reservas, contratos de inventário/eventos/pedidos |
| Interface integrada | `src/components/layout/app-shell.tsx`, página de estoque, formulários/detalhes de equipamentos/eventos/pedidos, lista de pedidos, painel de reservas, clientes HTTP e providers compartilhados |
| Testes | `tests/auth-bootstrap.test.ts`, `tests/auth.test.ts`, `tests/helpers/integration-auth.ts`, regressões `inventory/events/requests.test.ts`, `tests/e2e/fixtures.ts`, `auth.spec.ts`, `admin-users.spec.ts`, adaptação das cinco suítes de navegador anteriores |
| Documentação | `README.md`, este documento |

## Verificações e erros corrigidos

- ESLint com zero avisos, TypeScript e build de produção aprovados.
- **51 testes de integração aprovados, sem skips**, em `unieventos_test`: bootstrap concorrente; 17 cenários de autenticação/autorização; 33 regressões de estoque, eventos e solicitações adaptadas a sessões reais.
- **56 cenários de navegador validados**, em Chrome desktop e celular emulado: 16 novos de autenticação/administração e 40 regressões anteriores. A última suíte completa aprovou 54; os dois cenários anônimos restantes falharam apenas por seletor de alerta ambíguo, foram corrigidos e repetidos com aprovação em ambos os projetos. Não ficaram falhas funcionais pendentes.
- Os cenários incluem login/logout e replay de cookie revogado, domínio sem conta cadastrada, permissões forjadas e atualização de sessão adulterada, acesso negado a usuários/eventos/pedidos alheios, concessão de permissão de estoque, desativação e revogação, cancelamentos por políticas distintas, aprovação/recusa/cancelamento na interface e concorrência HTTP de aprovações.
- Migrações aplicadas nos dois bancos sem reset; todos os quatro checksums coincidem com os arquivos. Hashes/contagens das treze tabelas anteriores do banco de uso permaneceram idênticos. O banco de uso estava vazio e continuou vazio; `User`, `AppSession`, `LoginThrottle` e `AuditLog` também permaneceram vazios no banco de uso.
- `npm audit --omit=dev`: zero vulnerabilidades reportadas nas dependências de produção na execução desta entrega.

O executor TypeScript precisou sair da restrição do terminal Windows, mantendo a conexão limitada ao banco isolado. Não foram expostos credenciais, tokens ou segredos nos resultados. O comando de configuração de autenticação foi executado sem imprimir o segredo e preservou a configuração válida existente.

Foram corrigidos: tipagem da sessão Auth.js, validação de domínio também na sessão/retomada transacional, importação de Auth.js no executor de testes React Server, herança acidental de cookies administrativos em contextos que deveriam ser anônimos, seletor de alerta ambíguo com o anunciador de rotas do Next.js, permissões de edição de evento alheio explicitamente concedidas, textos antigos de ausência de autenticação e proteção do próprio autorizador interno contra identidade fabricada. Não foi necessário reescrever os módulos concluídos.

## Limitações e pendências operacionais

- Criar o primeiro ADMIN real e cadastrar as contas autorizadas; revisar concessões com os responsáveis institucionais.
- Definir implantação HTTPS, gestão/rotação de segredos e backups do PostgreSQL. O ambiente local não substitui essas configurações institucionais.
- Auth.js está em versão beta fixada; atualizações futuras devem repetir os testes de sessão e autorização.
- Não há SSO, MFA, recuperação de senha por e-mail ou troca obrigatória da senha inicial. A redefinição atual é administrativa; sua entrega deve usar canal seguro.
- Não há interface de consulta global da auditoria nem painel de sessões por dispositivo. Auditoria fica persistida no banco; logout encerra a sessão atual e mudanças de segurança revogam as sessões da conta.
- Registros históricos sem autoria não ganham autor retroativo. O contato operacional declarado não comprova a identidade de quem o preencheu antes da autenticação.
- Movimentações continua demonstrativo; retiradas/devoluções reais permanecem fora desta etapa.
- Testes móveis usam emulação. Validar a operação institucional, leitores de tela e aparelhos reais.
- O adaptador Prisma/`pg` ainda pode emitir aviso de depreciação interno, sem falha funcional nos testes.
