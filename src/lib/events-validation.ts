import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { DEPARTMENTS } from "@/types/events";

const instant = z.string().max(40).refine((value) => {
  try { Temporal.Instant.from(value); return /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(new Date(value).getTime()); }
  catch { return false; }
}, "Informe um instante válido com fuso horário.");

export const eventSchema = z.object({
  title: z.string().trim().min(3, "Informe um título com pelo menos 3 caracteres.").max(160, "Use até 160 caracteres."),
  description: z.string().trim().min(3, "Descreva o evento.").max(4000, "Use até 4.000 caracteres."),
  department: z.enum(["Multimeios", "Marketing", "Projeto de Extensão"], { error: "Selecione um setor organizador." }),
  responsibleName: z.string().trim().min(2, "Informe o responsável declarado.").max(120, "Use até 120 caracteres."),
  contact: z.string().trim().min(3, "Informe o contato do responsável.").max(160, "Use até 160 caracteres.").refine((value) => z.email().safeParse(value).success || (/^[+\d\s().-]+$/.test(value) && value.replace(/\D/g, "").length >= 8 && value.replace(/\D/g, "").length <= 15), "Informe um e-mail ou telefone válido."),
  location: z.string().trim().min(2, "Informe o local do evento.").max(160, "Use até 160 caracteres."),
  kind: z.enum(["INTERNAL", "EXTERNAL"]),
  status: z.enum(["PLANNED", "CONFIRMED", "COMPLETED", "CANCELLED"]),
  startsAt: instant,
  endsAt: instant,
  equipmentNeeds: z.array(z.object({ equipmentId: z.uuid("Selecione um equipamento válido."), quantity: z.number().int("Informe uma quantidade inteira.").min(1, "A quantidade deve ser maior que zero.").max(1_000_000, "A quantidade excede o limite."), notes: z.string().trim().max(1000, "Use até 1.000 caracteres.") }).strict()).max(100, "Informe até 100 necessidades por evento."),
  version: z.number().int().min(1).optional(),
  reason: z.string().trim().max(500, "Use até 500 caracteres.").optional(),
}).strict().superRefine((value, context) => {
  if (new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()) context.addIssue({ code: "custom", path: ["endsAt"], message: "O término deve ser posterior ao início." });
  const ids = new Set<string>();
  value.equipmentNeeds.forEach((need, index) => {
    if (ids.has(need.equipmentId)) context.addIssue({ code: "custom", path: ["equipmentNeeds", index, "equipmentId"], message: "Este equipamento já foi informado." });
    ids.add(need.equipmentId);
  });
});

export const eventArchiveSchema = z.object({ version: z.number().int().min(1), reason: z.string().trim().min(3, "Informe o motivo do arquivamento.").max(500) }).strict();

export function validateEvent(input: unknown, editing = false) {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, fieldErrors: Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join("."), issue.message])) };
  if (editing && !parsed.data.version) return { success: false as const, fieldErrors: { version: "Reabra o evento para obter os dados atuais." } };
  if (editing && (!parsed.data.reason || parsed.data.reason.length < 3)) return { success: false as const, fieldErrors: { reason: "Informe o motivo da alteração com pelo menos 3 caracteres." } };
  return { success: true as const, data: parsed.data };
}

export function isEventDepartment(value: string) { return DEPARTMENTS.includes(value as (typeof DEPARTMENTS)[number]); }
