# Verificação da etapa 3 — Eventos e Agenda Compartilhada

## Isolamento e execução

Os testes que gravam registros usam exclusivamente `unieventos_test`. `TEST_DATABASE_URL` deve apontar para esse banco e ser diferente de `DATABASE_URL`; os helpers de integração e navegador substituem a conexão apenas no processo de teste. Não execute testes contra o banco de uso e não apague `.local/postgres/data`.

As migrações são aplicadas com `migrate deploy`, sem resetar bases ou sobrescrever o estoque. Os cenários usam nomes únicos e arquivam os próprios eventos e equipamentos ao terminar; preservam os históricos do banco isolado.

```powershell
npm.cmd run db:test:migrate
npm.cmd run test:integration
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e -- --workers=2
```

Para usar o Chrome já instalado, defina `$env:PLAYWRIGHT_CHANNEL = 'chrome'`. Quando o Windows restringir o encerramento da árvore de processos do Playwright, inicie `node scripts/test-database.mjs server` em outro terminal e execute com `$env:PLAYWRIGHT_REUSE_TEST_SERVER = '1'`. Esse servidor fica na porta 3100 e recebe a conexão de testes do helper. O servidor da aplicação de uso permanece separado.

## Cobertura de navegador

`tests/e2e/events.spec.ts` roda em desktop e em celular emulado:

- Cadastro com responsáveis declarados, datas no fuso institucional e validação de término, contato e quantidades negativas.
- Equipamentos reais vinculados como necessidades preliminares, incluindo quantidade acima da disponibilidade atual, sem alterar total, disponível, reservado, em uso, manutenção ou versão do equipamento.
- Persistência após recarga, edição com motivo, cancelamento com preservação do registro, histórico e arquivamento com motivo.
- Agenda compartilhada dos três setores; busca e filtros combinados por setor, intervalo de datas, tipo, status e local.
- Calendário mensal, semanal e lista com registros reais, incluindo evento que atravessa meia-noite; estados vazios e erro de consulta com recuperação.
- Sobreposição informativa no mesmo local, exclusão de cancelados dos alertas e ausência de conflito quando o local muda; gravação permitida apesar do aviso.
- Dashboard e busca global consultando eventos persistidos, preservando acesso aos indicadores reais de estoque; indicadores de eventos vazios ou indisponíveis, com nova tentativa de consulta sem apresentar zero fictício na falha.
- Verificação de largura da página nas resoluções desktop e móvel.

`tests/e2e/ui.spec.ts` preserva as regressões gerais e de busca do estoque. Os testes que afirmavam que eventos desapareciam após recarregar e dependiam dos nomes fictícios foram substituídos pelos cenários persistidos. A navegação do calendário utiliza o mês institucional corrente, sem data de demonstração fixa.

Os casos de agenda vazia e indisponível interceptam somente respostas de consulta no navegador. Isso permite verificar a apresentação sem excluir dados persistidos. Cadastro, edição, cancelamento, arquivamento, conflitos e consulta após recarga usam a API e o PostgreSQL reais do ambiente de testes.

## Resultados desta entrega

- **30 execuções de navegador aprovadas em 36,7 segundos**, com Chrome e dois workers, contra o build de produção servido na porta 3100 com o banco isolado: 12 de Eventos, 10 regressões de Estoque e 8 regressões gerais, divididas igualmente entre desktop e celular emulado.
- **ESLint dos arquivos de navegador alterados aprovado sem avisos**: `npx.cmd eslint tests/e2e/events.spec.ts tests/e2e/ui.spec.ts --max-warnings=0`.
- **16 testes de integração aprovados**, incluindo a suíte de estoque preservada e a suíte de eventos, conforme execução do processo principal da entrega.
- **Build de produção aprovado**, conforme execução do processo principal antes de iniciar o servidor isolado. Os resultados finais de lint global, TypeScript e build após a revisão ficam na documentação da entrega.

Todos os cenários de navegador passaram na primeira execução completa, sem retries. O Playwright gerou capturas do Dashboard em desktop e celular na pasta local `test-results`; resultados e capturas são artefatos de execução, não dados da aplicação nem arquivos para versionar.

## Conferência manual recomendada

1. Confirmar a nomenclatura institucional dos setores, locais e contatos e os textos que identificam responsáveis declarados e necessidades preliminares.
2. Conferir cadastro e leitura de eventos em aparelhos móveis reais, inclusive navegação por teclado e leitores de tela.
3. Usar dois dispositivos configurados com fusos diferentes e conferir que o mesmo evento mantém o horário institucional exibido.
4. Reiniciar a aplicação e o PostgreSQL local, executar `db:start` quando necessário e confirmar permanência dos cadastros.
5. Conferir o entendimento de que o aviso de coincidência de local/horário é informativo e de que solicitar equipamento ainda não reserva nem retira estoque.

Os testes de recarga comprovam persistência entre requisições; não simulam reinício do computador. A emulação móvel não substitui a conferência em aparelhos reais. Não há autenticação, verificação de identidade ou aprovação de necessidades nesta etapa.
