# Arquitetura do UniEventos

> **Estado atual — etapa 6:** Estoque, Eventos, Solicitações, Reservas e Movimentações utilizam PostgreSQL e Prisma, com autenticação Auth.js e autorização no servidor. Consulte o [README](../README.md), a [entrega de Movimentações](movements-stage6-delivery.md) e o schema em `prisma/schema.prisma`. As seções abaixo preservam o planejamento histórico da primeira etapa; referências a demonstração, ausência de banco ou funcionalidades futuras descrevem aquele estágio.


## Escopo desta etapa

O UniEventos centraliza a visão administrativa dos eventos e dos equipamentos utilizados por Multimeios, Marketing e Projeto de Extensão. A primeira etapa utiliza Next.js com App Router, TypeScript, Tailwind CSS e componentes baseados em shadcn/ui. Os dados são fictícios e ficam em memória; autenticação, banco de dados, API de persistência e regras transacionais ainda não estão implementados.

Os contratos de domínio estão em `src/types/domain.ts`. As coleções de demonstração ficam em `src/lib/mock-data.ts`, separadas dos componentes de apresentação. Essa separação permite substituir a fonte dos dados sem acoplar a interface a um cliente de banco.

## Dados de demonstração

A referência da demonstração é **21 de outubro de 2026**, definida por `DEMO_TODAY`. O calendário não depende da data do dispositivo, o que mantém os indicadores reproduzíveis.

| Export | Conteúdo |
| --- | --- |
| `events` | 10 eventos internos e externos, distribuídos entre os três setores |
| `equipment` | 8 tipos de equipamentos, com 92 unidades no total |
| `requests` | 6 solicitações, incluindo pendentes, aprovadas e recusada |
| `movements` | 6 registros de retirada ou devolução, incluindo uma devolução em atraso |
| `activity` | 5 itens para a atividade recente |

Cada equipamento possui saldos não negativos e respeita `total = available + reserved + inUse + maintenance`. O snapshot contém 45 unidades disponíveis, 25 reservadas, 18 em uso e 4 em manutenção. As solicitações e movimentações são amostras da operação, e não um histórico completo para recompor esses saldos. Reservas aprovadas para momentos diferentes também podem reutilizar as mesmas unidades.

As datas civis usam `YYYY-MM-DD`, os horários dos eventos usam `HH:mm` e os instantes das movimentações incluem o offset `-03:00`. A apresentação deve considerar `America/Sao_Paulo` e preservar datas civis sem convertê-las inadvertidamente para o dia anterior.

## Evolução prevista para PostgreSQL e Prisma

Prisma e PostgreSQL não são instalados nesta etapa. A futura integração deverá adicionar um schema, migrações e um adaptador de persistência depois que os fluxos de negócio forem validados.

O modelo relacional previsto inclui:

| Entidade futura | Responsabilidade e relacionamentos |
| --- | --- |
| `Department` | Setor responsável; possui eventos e solicitações |
| `Event` | Evento com local, início, término, categoria e status; pertence a um setor e possui solicitações |
| `Equipment` | Tipo de equipamento e quantidade patrimonial; associado a itens de solicitação, reservas e movimentos |
| `EquipmentRequest` | Solicitação vinculada a evento e setor, com responsável, status e observação |
| `RequestItem` | Quantidade solicitada por equipamento; pertence a uma solicitação |
| `Reservation` | Alocação aprovada com intervalo de utilização, vinculada à solicitação |
| `ReservationItem` | Quantidade de um equipamento alocada em uma reserva |
| `Movement` | Retirada ou devolução de uma quantidade de equipamento, vinculada ao evento e à alocação correspondente |
| `Maintenance` | Quantidade indisponível e intervalo de manutenção |

`Event` e `Equipment` possuem relação de muitos para muitos materializada pelos itens das solicitações e reservas. O campo `equipmentIds` do contrato atual é uma projeção conveniente para a interface. Os IDs estáveis da demonstração podem ser mantidos em um seed; os registros reais podem usar UUIDs com códigos de exibição separados.

O estoque atual trabalha com tipos e quantidades. Se o controle patrimonial individual for necessário, uma entidade adicional `EquipmentUnit` poderá identificar número de patrimônio, série e estado de cada unidade, sem alterar a identificação dos tipos exibidos no catálogo.

## Reservas e consistência

Disponibilidade futura depende do intervalo solicitado. A quantidade reservada exibida no snapshot não deve substituir uma consulta de disponibilidade por horário. Para um intervalo `[início, término)`, há sobreposição quando `existing.startsAt < requested.endsAt` e `existing.endsAt > requested.startsAt`; reservas adjacentes são permitidas. O intervalo deve incluir o tempo necessário para montagem, retirada e devolução, conforme a regra operacional definida pelos setores.

A aprovação deverá conferir a capacidade em cada trecho do intervalo, considerando reservas ativas, unidades em manutenção e retiradas ainda não devolvidas. Somar todas as reservas que encostam no intervalo pode produzir um resultado incorreto quando elas não ocorrem simultaneamente. Cancelamentos e recusas não devem ocupar capacidade.

A consulta de disponibilidade e a gravação da reserva deverão ocorrer na mesma transação. Bloqueios por equipamento, adquiridos em ordem estável, ou transações serializáveis com repetição controlada devem impedir duas aprovações concorrentes acima da capacidade. Uma simples validação na interface não garante essa propriedade.

Retiradas e devoluções deverão registrar o movimento e atualizar a alocação na mesma transação. Uma devolução parcial deve reduzir apenas a quantidade pendente; a soma devolvida não pode exceder a quantidade retirada. Registrar uma retirada de uma reserva já contada não pode descontar a capacidade duas vezes. Chaves de idempotência deverão impedir duplicação em reenvios.

As restrições previstas são: quantidades inteiras positivas nos itens; saldos não negativos; início anterior ao término; referências válidas por chaves estrangeiras; unicidade de equipamento por solicitação; e transições de status permitidas. As regras que dependem de somas entre registros precisarão de transações e validação no servidor, além de constraints locais do PostgreSQL. Alterações de estoque deverão preservar um histórico auditável, em vez de apagar movimentos concluídos.

Instantes reais deverão ser persistidos em UTC com `timestamptz`, mantendo `America/Sao_Paulo` como fuso de exibição institucional. A combinação da data civil com o horário e o fuso deverá acontecer explicitamente na fronteira de entrada.

## Limites entre interface e persistência

Uma camada de aplicação poderá fornecer operações como `listEvents`, `getDashboard`, `checkAvailability`, `approveRequest`, `registerWithdrawal` e `registerReturn`. Essas operações deverão centralizar validação e transações, evitando regras de estoque dentro de componentes React.

Contratos de repositório, como `EventRepository`, `EquipmentRepository`, `RequestRepository` e `MovementRepository`, poderão receber primeiro um adaptador em memória e depois um adaptador Prisma. O contrato de disponibilidade deve receber início, término e quantidades, em vez de expor somente um saldo global. Os componentes consumirão DTOs de domínio, sem importar tipos gerados pelo Prisma.

A implantação da persistência deverá incluir migrações revisadas, seed de desenvolvimento e testes de concorrência, cancelamento e devolução parcial. Credenciais e o cliente Prisma deverão permanecer no servidor. Quando autenticação for planejada, permissões por setor e a identidade do operador serão acrescentadas aos casos de uso e ao histórico de auditoria; não há implementação de autenticação nesta etapa.
