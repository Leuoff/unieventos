# Entrega — Gestão de Estoque

## Resultado

O módulo Estoque passou a usar PostgreSQL com Prisma, preservando a identidade visual, sidebar, componentes e padrões da aplicação. O banco de uso `unieventos` começou vazio e permanece separado de `unieventos_test`. Nenhum equipamento fictício foi importado.

Foram implementados cadastro, leitura, edição e arquivamento; listagem com busca, filtros e paginação; equipamentos por quantidade e unidades patrimoniais; saldos separados; validação no cliente/servidor/banco; detalhes com histórico; conflitos de versão e bloqueio de exclusão com vínculos ativos. O número de patrimônio é normalizado e único, e sua troca entre duas unidades preserva a identidade e o histórico de ambas.

A exclusão usa arquivamento porque todo cadastro já tem histórico. Os registros arquivados podem ser consultados pelo filtro próprio. Reservas ativas, retirada não devolvida e manutenção impedem arquivamento. Reservas futuras não são indevidamente subtraídas do saldo atual; ajustes de quantidade respeitam o pico de demanda no intervalo. As gravações usam transações serializáveis e controle otimista de versão.

## Arquivos alterados

| Grupo | Arquivos |
| --- | --- |
| Dependências/configuração | `package.json`, `package-lock.json`, `.gitignore`, `eslint.config.mjs`, `playwright.config.ts` |
| Interface existente | `src/app/estoque/page.tsx`, `src/app/layout.tsx`, `src/components/dashboard/dashboard.tsx`, `src/components/layout/app-shell.tsx` |
| Regressões existentes | `tests/e2e/ui.spec.ts` |
| Documentação existente | `README.md`, `docs/architecture.md`, `docs/stock-stage2-proposal.md` |

## Arquivos criados

| Grupo | Arquivos |
| --- | --- |
| Prisma e migração | `prisma.config.ts`, `prisma/schema.prisma`, `prisma/migrations/migration_lock.toml`, `prisma/migrations/202610210001_inventory/migration.sql` |
| Ambiente/ciclo local | `.env.example`, `scripts/local-postgres.mjs`, `scripts/test-database.mjs` |
| Contratos e validação | `src/types/inventory.ts`, `src/lib/inventory-validation.ts`, `src/lib/inventory-client.ts` |
| Persistência/regras | `src/server/prisma.ts`, `src/server/inventory-service.ts`, `src/server/inventory-error.ts`, `src/server/inventory-http.ts` |
| API | `src/app/api/equipment/route.ts`, `src/app/api/equipment/[id]/route.ts`, `src/app/api/equipment/overview/route.ts` |
| Estado compartilhado real | `src/components/providers/inventory-provider.tsx` |
| Componentes Estoque | `src/components/inventory/equipment-form.tsx`, `src/components/inventory/equipment-detail.tsx`, `src/components/inventory/equipment-detail-page.tsx`, `src/components/inventory/inventory-controls.tsx` |
| Rota de detalhes | `src/app/estoque/[id]/page.tsx` |
| Testes/documentação | `tests/inventory.test.ts`, `tests/e2e/stock.spec.ts`, `docs/stock-stage2-testing.md`, `docs/stock-stage2-delivery.md` |

Arquivos locais de execução, fora do Git: `.env`, `.local/postgres/`, `src/generated/prisma/`, `.next/`, caches e resultados de testes. O código gerado do Prisma é recriado automaticamente na instalação. Credenciais e arquivos do banco não são artefatos a versionar.

## Verificações

- Lint com zero avisos e TypeScript sem erros.
- Build de produção com rotas de API e detalhes dinâmicas.
- 9 testes de integração contra PostgreSQL: validação; constraints e histórico; reserva/retirada sem dupla contagem; devolução parcial; bloqueio por reservas futuras; intervalos adjacentes e sobrepostos; integridade patrimonial; concorrência; arquivamento; permuta de patrimônios (alguns cenários compartilham um teste).
- 22 execuções de navegador, em Chrome desktop e celular emulado: CRUD, recarga, erros de formulário, patrimônio duplicado, edição de unidades, histórico, manutenção, arquivamento, paginação, filtros, estoque vazio/falha e regressões de navegação/busca/eventos.
- Consulta de conferência ao banco de uso: zero equipamentos após os testes, comprovando a separação do inventário de uso.

O banco e as regras foram testados de fato, sem substituir persistência por arrays. Casos de falha/vazio de interface também foram simulados por interceptação de rede no navegador; não exigiram apagar o inventário de uso.

## Conferências que precisam de validação do usuário

1. Nomenclatura de categorias, locais e padrões de patrimônio com os três setores.
2. Uso dos formulários e navegação por teclado em aparelhos móveis reais.
3. Reinício do computador/ambiente local, seguido de `db:start`, e conferência de permanência dos cadastros reais.
4. Fluxo de trabalho em duas abas e entendimento das mensagens de conflito e manutenção.

Os detalhes estão em [Verificação da etapa 2](stock-stage2-testing.md).

## Limites de escopo

Eventos, Solicitações e Movimentações permanecem demonstrativos e explicitamente separados. A estrutura de reservas por intervalo e retiradas/devoluções existe para as próximas etapas, mas esses fluxos ainda não têm interface operacional real. Nenhuma autenticação foi adicionada. O PostgreSQL local é um ambiente de desenvolvimento; a definição da implantação institucional permanece para uma etapa posterior.