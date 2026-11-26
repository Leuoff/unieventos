# Verificação da gestão de estoque — etapa 2

Os testes que gravam equipamentos exigem `TEST_DATABASE_URL` apontando para um banco chamado **unieventos_test**. O servidor usado pelo Playwright também deve usar esse banco. Não execute as suítes de escrita contra o estoque institucional ou um servidor de desenvolvimento conectado a outro banco.

As fixtures recebem nomes e patrimônios `E2E` com identificador aleatório, são criadas durante cada cenário e arquivadas ao final. A limpeza encerra a manutenção dessas próprias fixtures antes do arquivamento, com ajuste justificado no histórico. Não existe importação automática dos equipamentos fictícios da primeira etapa. Os testes de estado vazio e de indisponibilidade usam respostas de rede controladas somente no navegador de teste; não alteram a base para simular essas condições.

## Cobertura automatizada

| Arquivo | Cenários |
| --- | --- |
| `tests/e2e/stock.spec.ts` | Cadastro por quantidade; quantidade negativa; manutenção superior ao total; confirmação de cadastro; leitura após recarga; edição com motivo obrigatório; saldos disponíveis, reservados, em uso e manutenção separados; histórico; exclusão bloqueada durante manutenção; arquivamento e consulta dos arquivados. |
| `tests/e2e/stock.spec.ts` | Cadastro individual; patrimônio global duplicado com diferença de maiúsculas/minúsculas; unidades disponíveis e em manutenção; total derivado das unidades; edição de estado patrimonial com motivo; busca por patrimônio e persistência após recarga. |
| `tests/e2e/stock.spec.ts` | Oito registros reais no banco de testes para paginação; combinação de busca, categoria, modo de controle e disponibilidade; retorno à primeira página após alterar filtros; busca sem resultados. |
| `tests/e2e/stock.spec.ts` | Falha de consulta e nova tentativa; estoque vazio sem recorrer a mocks; Dashboard com zero unidades sem `NaN` ou `Infinity`; ausência de rolagem horizontal nos fluxos principais. |
| `tests/e2e/ui.spec.ts` | Regressão da navegação, calendário, notificações e menu móvel; busca global de equipamento real com filtro de estoque ativo; reabertura de detalhes. Os cenários de eventos continuam verificando sua natureza demonstrativa em memória. |

O Playwright executa os cenários em desktop e celular. Fixtures de testes paralelos usam identificadores distintos; asserções de listagem filtram o próprio conjunto para não depender de totais globais mutáveis. O indicador de estoque do Dashboard deixa de exigir o valor fictício `45`.

## Execução

Com o ambiente de teste configurado conforme o README, use os scripts do projeto para executar lint, TypeScript, build e os testes de estoque/navegador. A configuração do Playwright deve iniciar o servidor de testes na porta `3100` com a conexão isolada; a aplicação de uso local pode continuar usando a porta `3000`.

Para conferir somente estes arquivos com o ESLint:

```powershell
node node_modules/eslint/bin/eslint.js tests/e2e/ui.spec.ts tests/e2e/stock.spec.ts --max-warnings=0
```

## Conferência manual recomendada

- Validar os nomes das categorias, locais de armazenamento, regras de identificação patrimonial e descrições com Multimeios, Marketing e Projeto de Extensão.
- Cadastrar um equipamento por quantidade e outro por patrimônio, fechar e reabrir o navegador, reiniciar o servidor local e conferir os dados e o histórico.
- Conferir legibilidade, navegação por teclado e uso dos formulários longos em dispositivos móveis reais, incluindo adição de várias unidades patrimoniais.
- Conferir as mensagens de conflito em duas abas editando o mesmo equipamento e a mensagem de indisponibilidade ao interromper/restabelecer o banco de desenvolvimento.
- Conferir bloqueio de exclusão e de ajustes quando houver reservas ativas ou retiradas sem devolução, usando os cenários de integração do servidor. Os módulos demonstrativos de solicitações e movimentações não criam esses vínculos reais.
- Validar a disponibilidade por intervalo nos testes do serviço; a interface completa de criação/aprovação de reservas e retiradas pertence às próximas etapas.

## Arquivos desta frente de testes

- Alterado `tests/e2e/ui.spec.ts`.
- Criado `tests/e2e/stock.spec.ts`.
- Criado `docs/stock-stage2-testing.md`.

## Resultado executado em 21/10/2026

- ESLint dos dois arquivos de testes: aprovado, sem avisos.
- Playwright com Chrome instalado, dois workers e servidor de produção conectado exclusivamente a `unieventos_test`: **22 testes aprovados em 18,1 segundos** — 11 em desktop e 11 em celular emulado.
- Comando de execução: `npm.cmd run test:e2e -- --workers=2`, com `PLAYWRIGHT_CHANNEL=chrome`. Nesta execução foi reutilizado apenas o servidor isolado iniciado pelo script `scripts/test-database.mjs`, por meio de `PLAYWRIGHT_REUSE_TEST_SERVER=1`.

A execução identificou uma falha real na verificação de origem das gravações pelo navegador; a correção no servidor foi validada pelos fluxos de cadastro, edição e exclusão. Os seletores foram ajustados para ignorar o anunciador de rotas do Next.js e esperar os patrimônios já normalizados em maiúsculas.

Limites desta suíte: a persistência é conferida após recarga e leitura pela API; reinício do servidor continua na conferência manual. Estado vazio e indisponibilidade são simulados com respostas de rede no navegador. Celular é emulado no Chrome; dispositivos reais, Firefox e Safari ainda precisam ser conferidos. Bloqueios com reservas/retiradas e concorrência pertencem à suíte de integração do servidor, cujos resultados são relatados separadamente.
