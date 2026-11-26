import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { authenticateCredentials, departmentForRole, getSessionUser, hashPassword, hashSessionToken, revokeSession, verifyPassword } from "@/server/auth-core";
import { requireActor, withSessionToken } from "@/server/auth-context";
import { createEquipment, deleteEquipment, getEquipmentDetail, listEquipment, updateEquipment } from "@/server/inventory-service";
import { archiveEvent, createEvent, getEventDetail, listEvents, updateEvent } from "@/server/events-service";
import { createRequest, createRequestDecisionService, decideRequest, getRequestDetail, importEventNeeds, listRequests, requestAvailability, submitRequest, updateRequest } from "@/server/requests-service";
import { bootstrapFirstAdmin, createUser, listUsers, updateUser } from "@/server/users-service";
import { InventoryError } from "@/server/inventory-error";
import { getPrisma } from "@/server/prisma";
import type { ManagedUser, Permission, UserInput, UserRole } from "@/types/auth";
import type { CalendarEvent, EventInput } from "@/types/events";
import type { EquipmentInput, InventoryEquipment } from "@/types/inventory";
import type { EquipmentRequest, RequestInput } from "@/types/requests";

assert.ok(process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname === "/unieventos_test", "Estes testes só podem acessar o banco isolado unieventos_test.");
const db = getPrisma();
const userIds: string[] = [], emails: string[] = [], eventIds: string[] = [], equipmentIds: string[] = [];
const startsAt = "2045-10-22T12:00:00Z", endsAt = "2045-10-22T15:00:00Z";
const errorStatus = (status: number) => (error: unknown) => error instanceof InventoryError && error.status === status;
const password = () => randomBytes(24).toString("base64url");
type Account = { user: ManagedUser; password: string; token: string };
let administrator: Account;
const as = <T>(account: Account, callback: () => T) => withSessionToken(account.token, callback);

async function account(role: UserRole, permissions: Permission[] = []): Promise<Account> {
  const secret = password(), email = `auth-${randomUUID()}@unisalesiano.com.br`;
  const user = await as(administrator, () => createUser({ name: `Conta isolada ${role}`, email, role, permissions, active: true, password: secret }));
  userIds.push(user.id); emails.push(email);
  const signedIn = await authenticateCredentials(email, secret);
  assert.ok(signedIn);
  return { user, password: secret, token: signedIn.sessionToken };
}
function userEdit(user: ManagedUser, overrides: Partial<UserInput> = {}): UserInput {
  return { name: user.name, email: user.email, role: user.role, active: user.active, permissions: user.permissions, version: user.version, ...overrides };
}
async function equipment(overrides: Partial<EquipmentInput> = {}) {
  const row = await as(administrator, () => createEquipment({ name: `Autorização estoque ${randomUUID()}`, category: "Teste isolado", description: "Fixture exclusiva dos testes de autenticação.", location: "Laboratório de teste", trackingMode: "QUANTITY", total: 4, maintenance: 0, units: [], ...overrides }));
  equipmentIds.push(row.id); return row;
}
function equipmentEdit(row: InventoryEquipment, overrides: Partial<EquipmentInput> = {}): EquipmentInput {
  return { name: row.name, category: row.category, description: row.description, location: row.location, trackingMode: row.trackingMode, total: row.total, maintenance: row.maintenance, units: row.units, version: row.version, reason: "Conferência de autorização", ...overrides };
}
function eventInput(owner: Account, overrides: Partial<EventInput> = {}): EventInput {
  return { title: `Autorização evento ${randomUUID()}`, description: "Fixture criada exclusivamente no banco de testes.", department: (departmentForRole(owner.user.role) || "Multimeios") as EventInput["department"], responsibleName: "Responsável informado do evento", contact: "teste@unisalesiano.com.br", location: `Sala teste ${randomUUID()}`, kind: "INTERNAL", status: "CONFIRMED", startsAt, endsAt, equipmentNeeds: [], ...overrides };
}
async function event(owner: Account, overrides: Partial<EventInput> = {}) {
  const { event: row } = await as(owner, () => createEvent(eventInput(owner, overrides)));
  eventIds.push(row.id); return row;
}
function eventEdit(row: CalendarEvent, overrides: Partial<EventInput> = {}): EventInput {
  return { title: row.title, description: row.description, department: row.department, responsibleName: row.responsibleName, contact: row.contact, location: row.location, kind: row.kind, status: row.status, startsAt: row.startsAt, endsAt: row.endsAt, equipmentNeeds: row.equipmentNeeds.map(({ equipmentId, quantity, notes }) => ({ equipmentId, quantity, notes })), version: row.version, reason: "Teste de autorização no servidor", ...overrides };
}
function requestInput(eventId: string, equipmentId: string, quantity = 1): RequestInput {
  return { eventId, responsibleName: "Responsável informado", startsAt, endsAt, notes: "Solicitação exclusiva do teste isolado", items: [{ equipmentId, quantity, notes: "Uso no encontro" }] };
}
function requestEdit(row: EquipmentRequest): RequestInput {
  return { eventId: row.eventId, responsibleName: row.responsibleName, startsAt: row.startsAt, endsAt: row.endsAt, notes: row.notes, items: row.items.map(({ equipmentId, quantity, notes }) => ({ equipmentId, quantity, notes })), version: row.version };
}
async function pending(owner: Account, meeting: CalendarEvent, item: InventoryEquipment) {
  const row = await as(owner, () => createRequest(requestInput(meeting.id, item.id)));
  return as(owner, () => submitRequest(row.id, row.version));
}

before(async () => {
  // A fixture administrativa nunca é criada por rota pública ou em outro banco.
  const id = randomUUID(), secret = password(), email = `auth-admin-${id}@unisalesiano.com.br`;
  const row = await db.user.create({ data: { id, name: "Administrador da integração de autenticação", email, passwordHash: await hashPassword(secret), role: "ADMIN", active: true, permissions: [] } });
  userIds.push(id); emails.push(email);
  const signedIn = await authenticateCredentials(email, secret);
  assert.ok(signedIn);
  administrator = { user: { id: row.id, name: row.name, email: row.email, role: row.role, active: row.active, department: row.department, permissions: [], version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }, password: secret, token: signedIn.sessionToken };
});

after(async () => {
  // Remove somente IDs pertencentes a este arquivo. Não há reset, truncate ou limpeza global.
  await db.withdrawalUnit.deleteMany({ where: { withdrawal: { equipmentId: { in: equipmentIds } } } });
  await db.withdrawal.deleteMany({ where: { equipmentId: { in: equipmentIds } } });
  await db.reservationUnit.deleteMany({ where: { reservation: { equipmentId: { in: equipmentIds } } } });
  await db.reservation.deleteMany({ where: { equipmentId: { in: equipmentIds } } });
  await db.requestHistory.deleteMany({ where: { request: { eventId: { in: eventIds } } } });
  await db.equipmentRequestItem.deleteMany({ where: { request: { eventId: { in: eventIds } } } });
  await db.equipmentRequest.deleteMany({ where: { eventId: { in: eventIds } } });
  await db.eventEquipmentNeed.deleteMany({ where: { eventId: { in: eventIds } } });
  await db.eventHistory.deleteMany({ where: { eventId: { in: eventIds } } });
  await db.calendarEvent.deleteMany({ where: { id: { in: eventIds } } });
  await db.stockHistory.deleteMany({ where: { equipmentId: { in: equipmentIds } } });
  await db.equipmentUnit.deleteMany({ where: { equipmentId: { in: equipmentIds } } });
  await db.equipment.deleteMany({ where: { id: { in: equipmentIds } } });
  await db.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await db.appSession.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.loginThrottle.deleteMany({ where: { key: { in: emails.map((email) => hashSessionToken(`account:${email}`)) } } });
  await db.$disconnect();
});

test("senhas usam scrypt com salt aleatório; comparação rejeita hash inválido e senha incorreta", async () => {
  const secret = password(), first = await hashPassword(secret), second = await hashPassword(secret);
  assert.match(first, /^scrypt\$32768\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.notEqual(first, second);
  assert.equal(first.includes(secret), false);
  assert.equal(await verifyPassword(secret, first), true);
  assert.equal(await verifyPassword(`${secret}-incorreta`, first), false);
  assert.equal(await verifyPassword(secret, "senha-em-texto"), false);
});

test("login exige conta previamente autorizada e domínio exato; token fica apenas como hash no banco", async () => {
  const owner = await account("MARKETING");
  const signedIn = await authenticateCredentials(` ${owner.user.email.toUpperCase()} `, owner.password);
  assert.ok(signedIn);
  assert.match(signedIn.sessionToken, /^[0-9a-f]{64}$/);
  const persisted = await db.appSession.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(signedIn.sessionToken) } });
  assert.notEqual(persisted.tokenHash, signedIn.sessionToken);
  assert.equal(persisted.userId, owner.user.id);
  assert.equal((await getSessionUser(signedIn.sessionToken))?.id, owner.user.id);
  const unknownEmail = `auth-unknown-${randomUUID()}@unisalesiano.com.br`;
  emails.push(unknownEmail);
  assert.equal(await authenticateCredentials(unknownEmail, owner.password), null, "Ter e-mail institucional não equivale a ter uma conta autorizada.");
  for (const domain of ["example.org", "unisalesiano.com.br.example.org", "sub.unisalesiano.com.br"]) {
    const email = `auth-outsider-${randomUUID()}@${domain}`;
    const row = await db.user.create({ data: { name: "Conta externa fixture", email, passwordHash: await hashPassword(owner.password), role: "ADMIN", active: true } });
    userIds.push(row.id); emails.push(email);
    assert.equal(await authenticateCredentials(email, owner.password), null, "Uma conta fora do domínio autorizado não deve entrar mesmo quando persistida manualmente.");
  }
  const audit = await db.auditLog.findFirstOrThrow({ where: { actorUserId: owner.user.id, action: "LOGIN" } });
  assert.equal(JSON.stringify(audit).includes(signedIn.sessionToken), false);
  assert.equal(JSON.stringify(audit).includes(owner.password), false);
});

test("logout, expiração e revogação tornam sessões persistidas imediatamente inválidas", async () => {
  const owner = await account("MULTIMEIOS");
  await revokeSession(owner.token);
  assert.equal(await getSessionUser(owner.token), null);
  assert.ok((await db.appSession.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(owner.token) } })).revokedAt);
  await as(owner, () => assert.rejects(requireActor(), errorStatus(401)));
  const second = await authenticateCredentials(owner.user.email, owner.password);
  assert.ok(second);
  await db.appSession.update({ where: { tokenHash: hashSessionToken(second.sessionToken) }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal(await getSessionUser(second.sessionToken), null);
  assert.equal(await getSessionUser(randomBytes(32).toString("hex")), null);
  assert.equal(await getSessionUser(owner.user.id), null);
  assert.equal(await db.auditLog.count({ where: { actorUserId: owner.user.id, action: "LOGOUT" } }), 1);
});

test("cinco tentativas incorretas bloqueiam inclusive senha válida até o fim da janela persistida", async () => {
  const owner = await account("EXTENSAO");
  for (let attempt = 0; attempt < 5; attempt++) assert.equal(await authenticateCredentials(owner.user.email, "Senha propositalmente incorreta"), null);
  assert.equal(await authenticateCredentials(owner.user.email, owner.password), null);
  const key = hashSessionToken(`account:${owner.user.email}`);
  assert.equal((await db.loginThrottle.findUniqueOrThrow({ where: { key } })).attempts, 5);
  await db.loginThrottle.update({ where: { key }, data: { windowEndsAt: new Date(Date.now() - 1000) } });
  assert.ok(await authenticateCredentials(owner.user.email, owner.password));
  assert.equal(await db.loginThrottle.findUnique({ where: { key } }), null);
});

test("servidor nega consultas e alterações sem sessão real, sem confiar em identidade declarada", async () => {
  await withSessionToken("invalid", async () => {
    await assert.rejects(listEquipment(new URLSearchParams()), errorStatus(401));
    await assert.rejects(listEvents(new URLSearchParams()), errorStatus(401));
    await assert.rejects(listRequests(new URLSearchParams()), errorStatus(401));
    await assert.rejects(listUsers(), errorStatus(401));
    await assert.rejects(decideRequest(randomUUID(), { action: "approve", version: 1 }), errorStatus(401));
  });
});

test("os três setores consultam estoque compartilhado mas não cadastram, alteram nem arquivam equipamentos", async () => {
  const item = await equipment();
  for (const role of ["MULTIMEIOS", "MARKETING", "EXTENSAO"] as const) {
    const owner = await account(role);
    await as(owner, async () => {
      assert.equal((await listEquipment(new URLSearchParams({ q: item.name }))).items[0].id, item.id);
      assert.equal((await getEquipmentDetail(item.id)).equipment.available, 4);
      assert.equal((await requestAvailability({ startsAt, endsAt, items: [{ equipmentId: item.id, quantity: 1 }] })).items[0].sufficient, true);
      await assert.rejects(createEquipment(equipmentEdit(item)), errorStatus(403));
      await assert.rejects(updateEquipment(item.id, equipmentEdit(item)), errorStatus(403));
      await assert.rejects(deleteEquipment(item.id, item.version), errorStatus(403));
    });
  }
  assert.equal((await db.equipment.findUniqueOrThrow({ where: { id: item.id } })).version, 1);
  assert.equal((await db.stockHistory.findFirstOrThrow({ where: { equipmentId: item.id } })).actorUserId, administrator.user.id);
});

test("eventos usam autoria autenticada; setor e userId forjados não concedem acesso a eventos alheios", async () => {
  const owner = await account("MULTIMEIOS"), sameSector = await account("MULTIMEIOS"), other = await account("MARKETING");
  const meeting = await event(owner);
  assert.equal(meeting.createdByUserId, owner.user.id);
  assert.equal((await db.eventHistory.findFirstOrThrow({ where: { eventId: meeting.id } })).actorUserId, owner.user.id);
  for (const outsider of [sameSector, other]) await as(outsider, async () => {
    assert.equal((await getEventDetail(meeting.id)).event.id, meeting.id, "A agenda permanece compartilhada.");
    await assert.rejects(updateEvent(meeting.id, eventEdit(meeting, { department: departmentForRole(outsider.user.role) as EventInput["department"] })), errorStatus(403));
    await assert.rejects(archiveEvent(meeting.id, meeting.version, "Tentativa de arquivar evento alheio"), errorStatus(403));
  });
  await as(owner, async () => {
    await assert.rejects(createEvent(eventInput(owner, { department: "Marketing" })), errorStatus(403));
    await assert.rejects(createEvent({ ...eventInput(owner), createdByUserId: administrator.user.id } as EventInput), errorStatus(422));
    const updated = await updateEvent(meeting.id, eventEdit(meeting, { title: "Evento próprio alterado com sessão real" }));
    assert.equal(updated.event.version, 2);
  });
  const legacy = await event(administrator);
  await db.calendarEvent.update({ where: { id: legacy.id }, data: { createdByUserId: null } });
  await db.eventHistory.updateMany({ where: { eventId: legacy.id }, data: { actorUserId: null } });
  await as(owner, () => assert.rejects(updateEvent(legacy.id, eventEdit(legacy)), errorStatus(403)));
  assert.equal((await db.eventHistory.findFirstOrThrow({ where: { eventId: legacy.id } })).actorUserId, null, "A autoria histórica desconhecida permanece preservada.");
});

test("solicitações isolam proprietários inclusive no mesmo setor e não aceitam evento ou identidade alheia", async () => {
  const owner = await account("MULTIMEIOS"), outsider = await account("MULTIMEIOS"), item = await equipment();
  const meeting = await event(owner, { equipmentNeeds: [{ equipmentId: item.id, quantity: 1, notes: "Preliminar" }] });
  const row = await as(owner, () => createRequest(requestInput(meeting.id, item.id)));
  assert.equal(row.createdByUserId, owner.user.id);
  await as(outsider, async () => {
    assert.equal((await listRequests(new URLSearchParams({ eventId: meeting.id }))).items.some(({ id }) => id === row.id), false);
    await assert.rejects(getRequestDetail(row.id), errorStatus(403));
    await assert.rejects(updateRequest(row.id, requestEdit(row)), errorStatus(403));
    await assert.rejects(submitRequest(row.id, row.version), errorStatus(403));
    await assert.rejects(decideRequest(row.id, { action: "cancel", version: row.version, reason: "Tentativa de cancelar solicitação alheia" }), errorStatus(403));
    await assert.rejects(createRequest(requestInput(meeting.id, item.id)), errorStatus(403));
    await assert.rejects(importEventNeeds(meeting.id), errorStatus(403));
  });
  await as(owner, () => assert.rejects(createRequest({ ...requestInput(meeting.id, item.id), createdByUserId: administrator.user.id } as RequestInput), errorStatus(422)));
  assert.equal((await db.equipmentRequest.findUniqueOrThrow({ where: { id: row.id } })).version, 1);
});

test("cancelar pedido próprio sem reserva é permitido; cancelar reserva aprovada requer permissão específica", async () => {
  const owner = await account("MARKETING"), item = await equipment(), meeting = await event(owner);
  const draft = await as(owner, () => createRequest(requestInput(meeting.id, item.id)));
  const cancelledDraft = await as(owner, () => decideRequest(draft.id, { action: "cancel", version: draft.version, reason: "Solicitação preliminar deixou de ser necessária" }));
  assert.equal(cancelledDraft.status, "CANCELLED");
  const submitted = await pending(owner, meeting, item);
  assert.equal((await as(owner, () => decideRequest(submitted.id, { action: "cancel", version: submitted.version, reason: "Pedido pendente retirado pela organização" }))).status, "CANCELLED");
  const row = await pending(owner, meeting, item);
  for (const action of ["approve", "refuse"] as const) await as(owner, () => assert.rejects(decideRequest(row.id, { action, version: row.version, reason: "Setor não representa autorização de análise" }), errorStatus(403)));
  const approved = await as(administrator, () => decideRequest(row.id, { action: "approve", version: row.version }));
  await as(owner, () => assert.rejects(decideRequest(row.id, { action: "cancel", version: approved.version, reason: "Autoria não permite cancelar reserva aprovada" }), errorStatus(403)));
  assert.equal((await db.reservation.findFirstOrThrow({ where: { requestItem: { requestId: row.id } } })).status, "ACTIVE");
  const cancelled = await as(administrator, () => decideRequest(row.id, { action: "cancel", version: approved.version, reason: "Administrador autorizou o cancelamento da reserva" }));
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal((await db.reservation.findFirstOrThrow({ where: { requestItem: { requestId: row.id } } })).status, "CANCELLED");
  const entries = await db.requestHistory.findMany({ where: { requestId: row.id } });
  assert.ok(entries.some((entry) => entry.action === "CADASTRO" && entry.actorUserId === owner.user.id));
  assert.ok(entries.some((entry) => entry.action === "APROVACAO" && entry.actorUserId === administrator.user.id));
  assert.ok(entries.some((entry) => entry.action === "CANCELAMENTO" && entry.actorUserId === administrator.user.id));
  assert.equal(await db.withdrawal.count({ where: { equipmentId: item.id } }), 0);
});

test("administrador recusa com justificativa e auditoria real, sem comprometer estoque", async () => {
  const owner = await account("EXTENSAO"), item = await equipment(), meeting = await event(owner);
  const row = await pending(owner, meeting, item);
  await as(administrator, () => assert.rejects(decideRequest(row.id, { action: "refuse", version: row.version, reason: "" }), errorStatus(422)));
  const refused = await as(administrator, () => decideRequest(row.id, { action: "refuse", version: row.version, reason: "Equipamento incompatível com as condições do local" }));
  assert.equal(refused.status, "REFUSED");
  const history = await db.requestHistory.findFirstOrThrow({ where: { requestId: row.id, action: "RECUSA" } });
  assert.equal(history.actorUserId, administrator.user.id);
  assert.match(history.description, /incompatível/);
  assert.equal(await db.reservation.count({ where: { equipmentId: item.id } }), 0);
});

test("serviço de decisões revalida a sessão e não aceita privilégio ou autoria fabricados pelo autorizador", async () => {
  const owner = await account("MARKETING"), item = await equipment(), meeting = await event(owner);
  const row = await pending(owner, meeting, item);
  const fabricated = createRequestDecisionService(async () => ({ actorUserId: owner.user.id, permissions: ["REQUEST_APPROVE"] }));
  await as(owner, () => assert.rejects(fabricated(row.id, { action: "approve", version: row.version }), errorStatus(403)));
  await withSessionToken("invalid", () => assert.rejects(fabricated(row.id, { action: "approve", version: row.version }), errorStatus(401)));
  await as(administrator, () => assert.rejects(fabricated(row.id, { action: "approve", version: row.version }), errorStatus(403)));
  assert.equal((await db.equipmentRequest.findUniqueOrThrow({ where: { id: row.id } })).status, "PENDING");
  assert.equal(await db.reservation.count({ where: { equipmentId: item.id } }), 0);
});

test("somente ADMIN administra contas; promoção própria, domínio externo e bootstrap repetido são negados", async () => {
  const owner = await account("MULTIMEIOS");
  await as(owner, async () => {
    await assert.rejects(listUsers(), errorStatus(403));
    await assert.rejects(createUser({ name: "Promoção indevida", email: `auth-forged-${randomUUID()}@unisalesiano.com.br`, role: "ADMIN", active: true, permissions: [], password: password() }), errorStatus(403));
    await assert.rejects(updateUser(owner.user.id, userEdit(owner.user, { role: "ADMIN" })), errorStatus(403));
  });
  await as(administrator, async () => {
    await assert.rejects(createUser({ name: "Conta externa", email: "externo@example.org", role: "MARKETING", active: true, permissions: [], password: password() }), errorStatus(400));
    await assert.rejects(updateUser(owner.user.id, userEdit(owner.user, { permissions: ["USERS_MANAGE"] })), errorStatus(400));
    await assert.rejects(updateUser(administrator.user.id, userEdit(administrator.user, { active: false })), errorStatus(403));
    await assert.rejects(updateUser(administrator.user.id, userEdit(administrator.user, { role: "MULTIMEIOS" })), errorStatus(403));
    const listed = await listUsers(new URLSearchParams({ q: owner.user.email }));
    assert.equal(listed.items[0].id, owner.user.id);
    assert.equal("passwordHash" in listed.items[0], false);
    assert.equal("authVersion" in listed.items[0], false);
  });
  await assert.rejects(bootstrapFirstAdmin({ name: "Segundo bootstrap não autorizado", email: `auth-bootstrap-${randomUUID()}@unisalesiano.com.br`, password: password() }), errorStatus(409));
});

test("permissões adicionais vêm do banco e sua revogação invalida imediatamente sessões antigas", async () => {
  const owner = await account("MULTIMEIOS"), item = await equipment();
  owner.user = await as(administrator, () => updateUser(owner.user.id, userEdit(owner.user, { permissions: ["INVENTORY_WRITE"] })));
  assert.equal(await getSessionUser(owner.token), null);
  const granted = await authenticateCredentials(owner.user.email, owner.password);
  assert.ok(granted); owner.token = granted.sessionToken;
  const changed = await as(owner, () => updateEquipment(item.id, equipmentEdit(item, { location: "Armazenamento atualizado com permissão real" })));
  assert.equal((await db.stockHistory.findFirstOrThrow({ where: { equipmentId: item.id, action: "ALTERACAO" } })).actorUserId, owner.user.id);
  owner.user = await as(administrator, () => updateUser(owner.user.id, userEdit(owner.user, { permissions: [] })));
  assert.equal(await getSessionUser(owner.token), null);
  await as(owner, () => assert.rejects(updateEquipment(item.id, equipmentEdit(changed)), errorStatus(401)));
  const revoked = await authenticateCredentials(owner.user.email, owner.password);
  assert.ok(revoked); owner.token = revoked.sessionToken;
  await as(owner, () => assert.rejects(updateEquipment(item.id, equipmentEdit(changed)), errorStatus(403)));
  assert.equal((await getSessionUser(owner.token))?.permissions.includes("INVENTORY_WRITE"), false);
});

test("cada operação consulta permissões atuais no banco, mesmo sem alterar a versão da sessão", async () => {
  const owner = await account("MULTIMEIOS", ["INVENTORY_WRITE"]), item = await equipment();
  assert.equal((await getSessionUser(owner.token))?.permissions.includes("INVENTORY_WRITE"), true);
  // Simula atualização administrativa externa: nenhum JWT ou cache pode manter o privilégio.
  await db.user.update({ where: { id: owner.user.id }, data: { permissions: [] } });
  const current = await getSessionUser(owner.token);
  assert.ok(current);
  assert.equal(current.permissions.includes("INVENTORY_WRITE"), false);
  await as(owner, () => assert.rejects(updateEquipment(item.id, equipmentEdit(item)), errorStatus(403)));
  assert.equal((await db.equipment.findUniqueOrThrow({ where: { id: item.id } })).version, 1);
});

test("permissão explícita de gerenciamento permite administrar evento alheio sem virar administrador", async () => {
  const owner = await account("MARKETING"), manager = await account("MULTIMEIOS", ["EVENT_MANAGE_ALL"]);
  const meeting = await event(owner);
  const changed = await as(manager, () => updateEvent(meeting.id, eventEdit(meeting, { title: "Evento revisado por conta com permissão adicional" })));
  assert.equal(changed.event.department, "Marketing");
  assert.equal((await db.eventHistory.findFirstOrThrow({ where: { eventId: meeting.id, action: "ALTERACAO" } })).actorUserId, manager.user.id);
  await as(manager, () => assert.rejects(listUsers(), errorStatus(403)));
});

test("desativação, mudança de perfil e troca de senha revogam sessões; reativar exige novo login", async () => {
  const owner = await account("MARKETING");
  owner.user = await as(administrator, () => updateUser(owner.user.id, userEdit(owner.user, { active: false })));
  assert.equal(await getSessionUser(owner.token), null);
  assert.equal(await authenticateCredentials(owner.user.email, owner.password), null);
  await as(owner, () => assert.rejects(listEquipment(new URLSearchParams()), errorStatus(401)));
  owner.user = await as(administrator, () => updateUser(owner.user.id, userEdit(owner.user, { active: true })));
  assert.equal(await getSessionUser(owner.token), null);
  let signedIn = await authenticateCredentials(owner.user.email, owner.password);
  assert.ok(signedIn); owner.token = signedIn.sessionToken;
  owner.user = await as(administrator, () => updateUser(owner.user.id, userEdit(owner.user, { role: "EXTENSAO" })));
  assert.equal(await getSessionUser(owner.token), null);
  signedIn = await authenticateCredentials(owner.user.email, owner.password);
  assert.ok(signedIn); owner.token = signedIn.sessionToken;
  assert.equal(signedIn.user.role, "EXTENSAO");
  assert.equal(signedIn.user.department, "Projeto de Extensão");
  const newPassword = password();
  owner.user = await as(administrator, () => updateUser(owner.user.id, userEdit(owner.user, { password: newPassword })));
  assert.equal(await getSessionUser(owner.token), null);
  assert.equal(await authenticateCredentials(owner.user.email, owner.password), null);
  assert.ok(await authenticateCredentials(owner.user.email, newPassword));
  const audit = await db.auditLog.findFirstOrThrow({ where: { actorUserId: administrator.user.id, entityId: owner.user.id, action: "USER_DEACTIVATED" } });
  assert.equal(JSON.stringify(audit).includes(newPassword), false);
  assert.equal(JSON.stringify(audit).includes("passwordHash"), false);
});

test("duas sessões administrativas reais não aprovam simultaneamente o mesmo patrimônio individual", async () => {
  const owner = await account("EXTENSAO"), otherAdmin = await account("ADMIN");
  const assetNumber = `AUTH-${randomUUID()}`;
  const item = await equipment({ trackingMode: "INDIVIDUAL", total: 1, units: [{ assetNumber, status: "AVAILABLE" }] });
  const firstMeeting = await event(owner), secondMeeting = await event(owner);
  const first = await pending(owner, firstMeeting, item), second = await pending(owner, secondMeeting, item);
  const results = await Promise.allSettled([
    as(administrator, () => decideRequest(first.id, { action: "approve", version: first.version })),
    as(otherAdmin, () => decideRequest(second.id, { action: "approve", version: second.version })),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && errorStatus(409)(rejected.reason));
  assert.equal(await db.reservation.count({ where: { equipmentId: item.id, status: "ACTIVE" } }), 1);
  assert.equal(await db.reservationUnit.count({ where: { unit: { equipmentId: item.id } } }), 1);
  const approvedHistory = await db.requestHistory.findMany({ where: { request: { eventId: { in: [firstMeeting.id, secondMeeting.id] } }, action: "APROVACAO" } });
  assert.equal(approvedHistory.length, 1);
  assert.ok([administrator.user.id, otherAdmin.user.id].includes(approvedHistory[0].actorUserId!));
  assert.equal((await as(administrator, () => getEquipmentDetail(item.id))).equipment.available, 1, "Uma reserva futura não equivale à retirada física.");
  assert.equal(await db.withdrawal.count({ where: { equipmentId: item.id } }), 0);
});
