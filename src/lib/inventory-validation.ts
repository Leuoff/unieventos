import { z } from "zod";

export const normalizeSearch = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();

const count = z.number({ error: "Informe uma quantidade numérica." }).int("Use uma quantidade inteira.").min(0, "A quantidade não pode ser negativa.").max(1_000_000, "A quantidade excede o limite permitido.");
const unit = z.object({
  id: z.uuid("Identificação da unidade inválida.").optional(),
  assetNumber: z.string().trim().min(1, "Informe o número de patrimônio.").max(80, "Use até 80 caracteres.").transform((value) => value.toLocaleUpperCase("pt-BR")),
  status: z.enum(["AVAILABLE", "RESERVED", "IN_USE", "MAINTENANCE", "LOST"], { error: "Selecione uma condição válida." }),
}).strict();

export const equipmentSchema = z.object({
  name: z.string().trim().min(2, "Informe um nome com pelo menos 2 caracteres.").max(120, "Use até 120 caracteres."),
  category: z.string().trim().min(2, "Informe uma categoria com pelo menos 2 caracteres.").max(80, "Use até 80 caracteres."),
  description: z.string().trim().max(2000, "Use até 2.000 caracteres."),
  location: z.string().trim().min(2, "Informe o local de armazenamento.").max(160, "Use até 160 caracteres."),
  trackingMode: z.enum(["QUANTITY", "INDIVIDUAL"], { error: "Selecione o modo de controle." }),
  total: count,
  maintenance: count,
  units: z.array(unit).max(200, "Cadastre até 200 unidades patrimoniais por equipamento."),
  reason: z.string().trim().max(500, "Use até 500 caracteres no motivo.").optional(),
  version: z.number().int().min(1).optional(),
}).strict().superRefine((value, context) => {
  if (value.maintenance > value.total) context.addIssue({ code: "custom", path: ["maintenance"], message: "A manutenção não pode superar o total." });
  if (value.trackingMode === "QUANTITY" && value.units.length) context.addIssue({ code: "custom", path: ["units"], message: "Itens por quantidade não possuem unidades patrimoniais." });
  if (value.trackingMode === "INDIVIDUAL") {
    if (!value.units.length) context.addIssue({ code: "custom", path: ["units"], message: "Cadastre ao menos uma unidade patrimonial." });
    if (value.total !== value.units.length) context.addIssue({ code: "custom", path: ["total"], message: "O total deve corresponder ao número de patrimônios." });
    if (value.maintenance !== value.units.filter((item) => item.status === "MAINTENANCE").length) context.addIssue({ code: "custom", path: ["maintenance"], message: "A manutenção deve corresponder às unidades em manutenção." });
    const assets = new Set<string>();
    const ids = new Set<string>();
    value.units.forEach((item, index) => {
      if (assets.has(item.assetNumber)) context.addIssue({ code: "custom", path: ["units", index, "assetNumber"], message: "Número de patrimônio repetido no formulário." });
      if (item.id && ids.has(item.id)) context.addIssue({ code: "custom", path: ["units", index, "id"], message: "Unidade repetida no formulário." });
      assets.add(item.assetNumber);
      if (item.id) ids.add(item.id);
    });
  }
});

export const deleteSchema = z.object({ version: z.number().int().min(1) }).strict();

export function validateEquipment(input: unknown, editing = false) {
  const result = equipmentSchema.safeParse(input);
  if (!result.success) return { success: false as const, fieldErrors: Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message])) };
  if (editing && (!result.data.reason || result.data.reason.length < 3)) return { success: false as const, fieldErrors: { reason: "Informe o motivo da alteração com pelo menos 3 caracteres." } };
  if (editing && !result.data.version) return { success: false as const, fieldErrors: { version: "Reabra o equipamento para obter a versão atual." } };
  return { success: true as const, data: result.data };
}
