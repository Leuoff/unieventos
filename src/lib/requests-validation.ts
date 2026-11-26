import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";

const instant = z.string().max(40).refine((value) => {
  try { Temporal.Instant.from(value); return /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(new Date(value).getTime()); }
  catch { return false; }
}, "Informe um instante válido com fuso horário.");

const item = z.object({
  equipmentId: z.uuid("Selecione um equipamento real."),
  quantity: z.number().int("Informe uma quantidade inteira.").min(1, "A quantidade deve ser maior que zero.").max(1_000_000, "A quantidade excede o limite."),
  notes: z.string().trim().max(1000, "Use até 1.000 caracteres."),
}).strict();

function periodAndItems(value: { startsAt: string; endsAt: string; items: { equipmentId: string }[] }, context: z.RefinementCtx) {
  if (new Date(value.endsAt) <= new Date(value.startsAt)) context.addIssue({ code: "custom", path: ["endsAt"], message: "O término deve ser posterior ao início." });
  const ids = new Set<string>();
  value.items.forEach((entry, index) => {
    if (ids.has(entry.equipmentId)) context.addIssue({ code: "custom", path: ["items", index, "equipmentId"], message: "Este equipamento já foi informado." });
    ids.add(entry.equipmentId);
  });
}

export const requestSchema = z.object({
  eventId: z.uuid("Selecione um evento real."),
  responsibleName: z.string().trim().min(2, "Informe o responsável declarado.").max(120),
  startsAt: instant,
  endsAt: instant,
  notes: z.string().trim().max(2000, "Use até 2.000 caracteres."),
  items: z.array(item).min(1, "Informe pelo menos um equipamento.").max(100, "Informe até 100 equipamentos."),
  version: z.number().int().min(1).optional(),
}).strict().superRefine(periodAndItems);

export const requestAvailabilitySchema = z.object({
  startsAt: instant,
  endsAt: instant,
  items: z.array(item.omit({ notes: true })).min(1).max(100),
}).strict().superRefine(periodAndItems);

export const requestSubmitSchema = z.object({ version: z.number().int().min(1) }).strict();
export const requestDecisionSchema = z.object({
  action: z.enum(["approve", "refuse", "cancel"]),
  version: z.number().int().min(1),
  reason: z.string().trim().max(1000).optional(),
}).strict().superRefine((value, context) => {
  if (value.action !== "approve" && (!value.reason || value.reason.length < 3)) context.addIssue({ code: "custom", path: ["reason"], message: "Informe uma justificativa com pelo menos 3 caracteres." });
});

export function validateRequest(input: unknown, editing = false) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, fieldErrors: Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join("."), issue.message])) };
  if (editing && !parsed.data.version) return { success: false as const, fieldErrors: { version: "Reabra a solicitação para obter a versão atual." } };
  return { success: true as const, data: parsed.data };
}
