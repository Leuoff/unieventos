# Etapa 2 — Gestão de Estoque: análise e proposta de persistência

Status: **aprovada pelo usuário ao solicitar continuação**. A implementação adotou PostgreSQL local e Prisma. Este documento preserva a análise anterior; consulte stock-stage2-delivery.md para o resultado implementado.

## O que já existe

| Recurso | Situação atual e reaproveitamento |
| --- | --- |
| Identidade e navegação | Preservar AppShell, sidebar, cabeçalho, cores, tipografia, rotas e comportamento móvel. |
| Listagem do estoque | Cards responsivos em `src/app/estoque/page.tsx`, com busca normalizada para acentos e filtros de categoria/disponibilidade. Reaproveitar. |
| Indicadores e saldos | A interface já exibe total, disponível, reservado, em uso e manutenção. São valores estáticos de demonstração; não existe controle transacional. |
| Consulta de detalhes | Diálogo acessível aberto por `/estoque?item=ID`. Preservar compatibilidade e acrescentar uma página de detalhes com histórico. |
| Componentes | Reaproveitar Button, Input, Dialog, Badge, PageHeader, EmptyState, SummaryCard, SearchField, FilterSelect e formatadores. |
| Domínio | `Equipment` tem nome, categoria, local e saldos. Faltam descrição, modo de controle, patrimônios e histórico persistido. |
| Fonte de dados | `DemoProvider` importa os equipamentos e movimentos de `src/lib/mock-data.ts`. Não há CRUD de equipamentos nem persistência. |
| Integrações | Dashboard, busca global, Eventos, Solicitações e Movimentações consultam os mesmos mocks. Os vínculos demonstrativos não podem passar a apontar automaticamente para equipamentos reais. |
| Verificações | Scripts de lint, TypeScript, build e Playwright já disponíveis. Testes atuais cobrem navegação, consulta e busca global; não verificam CRUD de estoque ou consistência no banco. |

Não foram encontrados no projeto Prisma, schema/migrations, configuração de conexão, API de persistência ou outro adaptador de banco. Também não foram identificados `docker`, `psql` ou `pg_ctl` no PATH, nem a pasta usual do PostgreSQL no Windows. Isso não descarta um banco acessível por outro endereço ou instalação fora desses locais.

## Proposta para aprovação

Adotar **PostgreSQL + Prisma**, conforme a evolução planejada na etapa 1. O banco será acessado exclusivamente no servidor Next.js, por uma camada de repositórios e serviços de estoque. A interface atual será mantida.

Escopo da autorização solicitada: instalar as dependências do Prisma e do adaptador PostgreSQL no projeto; criar schema, migrações, validações, operações de CRUD e conexão por variável de ambiente. A localização do PostgreSQL também precisa ser escolhida:

1. **PostgreSQL já disponível:** usar uma conexão de desenvolvimento fornecida/configurada pelo responsável, com banco/schema exclusivo para o UniEventos. Não reutilizar tabelas de outro sistema nem aplicar migrações destrutivas em dados existentes.
2. **PostgreSQL local:** instalar/configurar uma instância de desenvolvimento apenas após autorização explícita, com dados duráveis, usuário e banco próprios e acesso restrito à máquina. Não instalar Docker ou serviço de sistema implicitamente.

Nenhuma conta, serviço pago ou banco remoto será criado a partir desta proposta. Configuração e credenciais ficarão fora do Git. O arquivo de exemplo conterá somente placeholders.

O cadastro real começará **vazio**, com estado inicial orientando o primeiro cadastro. Os 8 tipos e 92 unidades fictícios não serão importados automaticamente. Dados de teste existirão apenas em banco/contexto isolado de teste e serão identificados como tais.

Referências técnicas: [Prisma ORM](https://www.prisma.io/docs/orm), [conector PostgreSQL](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql) e [bloqueios transacionais do PostgreSQL](https://www.postgresql.org/docs/18/explicit-locking.html).

## Modelo proposto

| Entidade | Dados e responsabilidade |
| --- | --- |
| Equipamento | ID, nome, categoria, descrição, local de armazenamento, modo `QUANTIDADE` ou `INDIVIDUAL`, datas de cadastro/alteração, versão para concorrência e arquivamento. |
| Unidade patrimonial | Equipamento de origem, número de patrimônio normalizado e único, estado e localização. Obrigatória para cada unidade de equipamento individual. |
| Saldo/lançamento | Entradas, ajustes justificados e manutenção. Quantidades inteiras; operações transacionais e histórico antes/depois. Saldos não serão campos independentes livremente editáveis. |
| Histórico | Cadastro, alterações, ajustes, manutenção, arquivamento e movimentações realmente registradas, com data, motivo e referência da operação. Não inventar operador autenticado. |
| Reserva e item de reserva | Estrutura preparada para equipamento/unidade, quantidade, início, término e status. Fluxo completo de solicitação/aprovação fica para a etapa correspondente. |
| Retirada e devolução | Estrutura relacionando item reservado, equipamento/unidade, quantidade e devoluções parciais. Retirada pendente de devolução é vínculo ativo, mesmo quando o registro da retirada está concluído. |

Para itens individuais, o total resulta da contagem das unidades patrimoniais; não poderá divergir de uma quantidade digitada. Para itens por quantidade, o total será controlado por entradas e ajustes. Mudança do modo de controle será bloqueada se houver histórico/vínculos que exijam uma conversão explícita.

## Regras a implementar

- Validar no formulário e novamente no servidor: nome/categoria/local, limites de texto, modo de controle, inteiros não negativos e patrimônio único quando obrigatório.
- Rejeitar reduções do total que comprometam unidades em uso, reservadas ou em manutenção; alterações do inventário exigem lançamento de ajuste e motivo.
- Separar reservado de retirado: a retirada transfere quantidade de reservado para em uso; a devolução retira de em uso e devolve à condição física apropriada. A mesma unidade não pode ser descontada duas vezes.
- Exibir saldos referentes ao instante consultado. Compromissos de datas futuras não serão subtraídos indiscriminadamente do saldo físico atual; a disponibilidade futura será uma consulta por intervalo.
- Preparar reservas com início anterior ao término e intervalos `[início, término)`. Calcular capacidade no pico de sobreposição, considerando manutenção e unidades não devolvidas. A aprovação futura deve bloquear concorrência na mesma transação.
- Bloquear exclusão/arquivamento com reservas ativas, retirada ainda não devolvida ou outro vínculo operacional ativo. A verificação será feita na transação do servidor, não apenas no botão.
- Equipamentos com histórico concluído serão arquivados, mantendo histórico e referências. Exclusão física será limitada a cadastros sem vínculos nem histórico operacional.
- Gravar mudanças e histórico atomicamente, controlar concorrência e apresentar erros de campo, conflito e indisponibilidade do banco em português. Falha no banco nunca fará a interface recorrer silenciosamente aos mocks.

## Incrementos de interface

1. Manter busca, filtros e cards; acrescentar filtros de modo de controle, paginação no servidor e ordenação estável. Alterar filtros volta à primeira página.
2. Acrescentar cadastro/edição com os componentes atuais e apresentação específica para unidades patrimoniais ou quantidade.
3. Acrescentar `/estoque/[id]` com informações, saldos e histórico paginado; manter os links atuais funcionais.
4. Acrescentar confirmação de exclusão/arquivamento com a justificativa de bloqueio quando houver vínculos ativos.
5. Exibir carregamento, lista vazia, erro com tentativa novamente e confirmação de sucesso, preservando acessibilidade e responsividade.
6. Integrar os indicadores de estoque e a busca global à mesma fonte persistida. Tratar inventário vazio no Dashboard, cuja divisão atual por `total` precisa de proteção contra zero. Eventos/solicitações/movimentações demonstrativos continuarão explicitamente identificados e isolados dos registros reais até a implementação de seus próprios fluxos. Não transformar seus vínculos fictícios em movimentos reais.

## Arquivos previstos para a implementação após aprovação

- Adaptar `src/app/estoque/page.tsx`, preservando a apresentação e os controles prontos.
- Acrescentar página de detalhes e componentes de formulário, paginação e histórico de estoque.
- Acrescentar contratos/validação do estoque, repositório Prisma e serviço transacional no servidor.
- Acrescentar endpoints ou Server Actions para consulta e mutações; escolher um único padrão ao implementar, seguindo as instruções locais do Next.js.
- Configurar Prisma, migrações e exemplo de ambiente depois da aprovação.
- Ajustar apenas os pontos de consumo necessários em DemoProvider, Dashboard e busca global para isolar dados reais e demonstrativos.
- Atualizar documentação e testes existentes sem reescrever módulos fora deste escopo.

## Critérios de teste da etapa

Após implementação, testar: persistência após recarga/reinício; cadastro/edição de ambos os modos; duplicação de patrimônio; quantidades negativas/fracionárias e redução inválida; paginação combinada com filtros; acesso direto e histórico; exclusão bloqueada com vínculo ativo; arquivamento sem perda de histórico; operações simultâneas; distinção entre reserva e retirada; estados de falha do banco; leitura e formulários no celular; regressão da busca global e indicadores. O teste atual que fixa 45 unidades disponíveis deverá usar o estado real esperado e cobrir o inventário vazio.

## Verificações realizadas nesta análise

`npm.cmd run lint`, `npm.cmd run typecheck` e `npm.cmd run build` passaram em 21/10/2026. Não há implementação da etapa 2 para validar ainda. Os testes de navegador da primeira etapa não foram reexecutados nesta análise documental.

Único arquivo de conteúdo criado nesta análise: `docs/stock-stage2-proposal.md`. Nenhum arquivo da aplicação ou dependência foi alterado.
