import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";

const quantity = z.number().int("Informe uma quantidade inteira.").min(0, "A quantidade não pode ser negativa.").max(1_000_000);
const instant = z.string().max(40).refine((value) => {
  try { Temporal.Instant.from(value); return /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(new Date(value).getTime()); }
  catch { return false; }
}, "Informe data e horário válidos com fuso horário.");
const checklist = z.object({
  quantityChecked: z.literal(true, { error: "Confira a quantidade." }),
  conditionChecked: z.literal(true, { error: "Confira a condição dos equipamentos." }),
  accessoriesChecked: z.literal(true, { error: "Confira acessórios e componentes." }),
}).strict();

export const withdrawalSchema = z.object({
  reservationId: z.uuid("Selecione uma reserva aprovada."),
  quantity: quantity.min(1, "Informe pelo menos uma unidade."),
  unitIds: z.array(z.uuid()).max(1000),
  responsibleName: z.string().trim().min(2, "Informe o responsável pela retirada.").max(120),
  destination: z.string().trim().min(2, "Informe o destino dos equipamentos.").max(160),
  notes: z.string().trim().max(2000),
  expectedReturnAt: instant.optional(),
  checklist,
}).strict().superRefine((value, context) => {
  if (new Set(value.unitIds).size !== value.unitIds.length) context.addIssue({ code: "custom", path: ["unitIds"], message: "Não repita patrimônios." });
});

export const settlementSchema = z.object({
  version: z.number().int().min(1),
  goodQuantity: quantity,
  damagedQuantity: quantity,
  lostQuantity: quantity,
  units: z.array(z.object({ unitId: z.uuid(), condition: z.enum(["GOOD", "DAMAGED", "LOST"]) }).strict()).max(1000),
  notes: z.string().trim().max(2000),
  checklist,
}).strict().superRefine((value, context) => {
  if (value.goodQuantity + value.damagedQuantity + value.lostQuantity < 1) context.addIssue({ code: "custom", path: ["goodQuantity"], message: "Informe a quantidade devolvida ou extraviada." });
  if (new Set(value.units.map((unit) => unit.unitId)).size !== value.units.length) context.addIssue({ code: "custom", path: ["units"], message: "Não repita patrimônios na conferência." });
  if ((value.damagedQuantity || value.lostQuantity) && value.notes.length < 3) context.addIssue({ code: "custom", path: ["notes"], message: "Descreva a avaria ou o extravio." });
});

export const extensionSchema = z.object({
  version: z.number().int().min(1),
  expectedReturnAt: instant,
  reason: z.string().trim().min(3, "Justifique a extensão de utilização.").max(1000),
}).strict();
