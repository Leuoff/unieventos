"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useInventory } from "@/components/providers/inventory-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InventoryApiError, inventoryRequest } from "@/lib/inventory-client";
import type { EquipmentInput, InventoryEquipment, TrackingMode, UnitStatus } from "@/types/inventory";
import { unitStatusLabels } from "./inventory-controls";

const controlClass = "min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-xs outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500";
type FormUnit = { key: string; id?: string; assetNumber: string; status: UnitStatus };

export function EquipmentForm({ equipment, categories = [], onClose, onSaved }: { equipment?: InventoryEquipment; categories?: string[]; onClose: () => void; onSaved: (equipment: InventoryEquipment) => void }) {
  const { refresh, notify } = useInventory();
  const id = useId();
  const [name, setName] = useState(equipment?.name ?? "");
  const [category, setCategory] = useState(equipment?.category ?? "");
  const [description, setDescription] = useState(equipment?.description ?? "");
  const [location, setLocation] = useState(equipment?.location ?? "");
  const [trackingMode, setTrackingMode] = useState<TrackingMode>(equipment?.trackingMode ?? "QUANTITY");
  const [total, setTotal] = useState(String(equipment?.total ?? 0));
  const [maintenance, setMaintenance] = useState(String(equipment?.maintenance ?? 0));
  const [units, setUnits] = useState<FormUnit[]>(equipment?.units.map((unit) => ({ ...unit, key: unit.id })) ?? [{ key: "first", assetNumber: "", status: "AVAILABLE" }]);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = equipment ? equipment.reserved + equipment.inUse + equipment.lost : 0;
  const quantity = trackingMode === "INDIVIDUAL" ? units.length : Number(total);
  const inMaintenance = trackingMode === "INDIVIDUAL" ? units.filter((unit) => unit.status === "MAINTENANCE").length : Number(maintenance);

  function field(key: string, label: string, children: ReactNode, hint?: string) {
    return <div><label htmlFor={`${id}-${key}`} className="mb-1.5 block text-xs font-medium text-slate-700">{label}</label>{children}{hint && <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p>}{errors[key] && <p id={`${id}-${key}-error`} className="mt-1 text-xs text-rose-700">{errors[key]}</p>}</div>;
  }
  function accessibility(key: string) {
    return { id: `${id}-${key}`, "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `${id}-${key}-error` : undefined };
  }
  function updateUnit(key: string, update: Partial<FormUnit>) { setUnits((current) => current.map((unit) => unit.key === key ? { ...unit, ...update } : unit)); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = "Informe um nome com pelo menos 2 caracteres.";
    if (category.trim().length < 2) next.category = "Informe a categoria do equipamento.";
    if (location.trim().length < 2) next.location = "Informe o local de armazenamento.";
    if (equipment && reason.trim().length < 3) next.reason = "Descreva o motivo da alteração com pelo menos 3 caracteres.";
    if (trackingMode === "QUANTITY") {
      if (!total.trim() || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1_000_000) next.total = "Informe uma quantidade inteira entre zero e 1.000.000.";
      if (!maintenance.trim() || !Number.isSafeInteger(inMaintenance) || inMaintenance < 0 || inMaintenance > 1_000_000) next.maintenance = "Informe uma quantidade inteira entre zero e 1.000.000.";
      if (!next.total && !next.maintenance && quantity < inMaintenance + busy) next.total = "O total deve cobrir as unidades em manutenção, reservadas e em uso.";
    } else {
      if (!units.length) next.units = "Adicione pelo menos uma unidade com patrimônio.";
      const seen = new Set<string>();
      units.forEach((unit, index) => {
        const asset = unit.assetNumber.trim().toUpperCase();
        if (!asset) next[`units.${index}.assetNumber`] = "Informe o número de patrimônio.";
        else if (seen.has(asset)) next[`units.${index}.assetNumber`] = "Este patrimônio está repetido.";
        seen.add(asset);
      });
    }
    setErrors(next);
    setError("");
    if (Object.keys(next).length) { setError("Revise os campos indicados antes de salvar."); return; }
    const input: EquipmentInput = { name: name.trim(), category: category.trim(), description: description.trim(), location: location.trim(), trackingMode, total: quantity, maintenance: inMaintenance, units: trackingMode === "INDIVIDUAL" ? units.map((unit) => ({ ...(unit.id ? { id: unit.id } : {}), assetNumber: unit.assetNumber.trim().toUpperCase(), status: unit.status })) : [], ...(equipment ? { version: equipment.version, reason: reason.trim() } : {}) };
    setSaving(true);
    try {
      const result = await inventoryRequest<{ equipment: InventoryEquipment }>(equipment ? `/api/equipment/${encodeURIComponent(equipment.id)}` : "/api/equipment", { method: equipment ? "PATCH" : "POST", body: JSON.stringify(input) });
      notify(equipment ? "Equipamento atualizado com sucesso." : "Equipamento cadastrado com sucesso.");
      void refresh();
      onSaved(result.equipment);
    } catch (failure) {
      if (failure instanceof InventoryApiError) { setErrors(failure.fieldErrors); setError(failure.message); }
      else setError("Não foi possível salvar o equipamento. Tente novamente.");
    } finally { setSaving(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}><DialogContent className="sm:max-w-2xl" onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}>
    <DialogHeader><DialogTitle>{equipment ? "Editar equipamento" : "Novo equipamento"}</DialogTitle><DialogDescription>{equipment ? "Atualize o cadastro e registre o motivo da alteração no histórico." : "Cadastre um recurso do campus e organize suas unidades no estoque."}</DialogDescription></DialogHeader>
    <form className="space-y-5" onSubmit={submit} noValidate>
      <fieldset disabled={saving} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {field("name", "Nome do equipamento", <Input {...accessibility("name")} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Ex.: Projetor multimídia" required />)}
          {field("category", "Categoria", <><Input {...accessibility("category")} value={category} onChange={(event) => setCategory(event.target.value)} maxLength={80} list={`${id}-categories`} placeholder="Ex.: Audiovisual" required /><datalist id={`${id}-categories`}>{[...new Set([...categories, "Audiovisual", "Áudio", "Informática", "Iluminação", "Acessórios"])].map((value) => <option key={value} value={value} />)}</datalist></>)}
        </div>
        {field("description", "Descrição", <textarea {...accessibility("description")} className={`${controlClass} min-h-20 resize-y`} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} placeholder="Características, modelo e observações do equipamento" />)}
        <div className="grid gap-4 sm:grid-cols-2">
          {field("location", "Local de armazenamento", <Input {...accessibility("location")} value={location} onChange={(event) => setLocation(event.target.value)} maxLength={160} placeholder="Ex.: Multimeios · Armário 02" required />)}
          {field("trackingMode", "Modo de controle", <select {...accessibility("trackingMode")} className={controlClass} value={trackingMode} disabled={!!equipment} onChange={(event) => setTrackingMode(event.target.value as TrackingMode)}><option value="QUANTITY">Por quantidade</option><option value="INDIVIDUAL">Por patrimônio</option></select>, equipment ? "O modo de controle é definido no cadastro." : "Identifique cada unidade ou controle o saldo em conjunto.")}
        </div>
        {trackingMode === "QUANTITY" ? <div className="grid gap-4 sm:grid-cols-2">
          {field("total", "Quantidade total", <Input {...accessibility("total")} type="number" min={0} max={1_000_000} step={1} value={total} onChange={(event) => setTotal(event.target.value)} required />)}
          {field("maintenance", "Em manutenção", <Input {...accessibility("maintenance")} type="number" min={0} max={1_000_000} step={1} value={maintenance} onChange={(event) => setMaintenance(event.target.value)} required />)}
        </div> : <section aria-label="Unidades patrimoniais" className="rounded-xl border border-slate-200 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-800">Unidades patrimoniais</h3><Button type="button" variant="outline" size="sm" disabled={units.length >= 200} onClick={() => setUnits((current) => [...current, { key: crypto.randomUUID(), assetNumber: "", status: "AVAILABLE" }])}><Plus /> Adicionar unidade</Button></div>
          <p className="mb-4 text-xs leading-relaxed text-slate-500">Cada patrimônio deve ser único. Unidades reservadas ou em uso só podem ser alteradas após encerrar o vínculo ativo.</p>
          <div className="space-y-4">{units.map((unit, index) => {
            const locked = unit.status === "RESERVED" || unit.status === "IN_USE" || unit.status === "LOST";
            return <div key={unit.key} className="grid items-start gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto]">
              {field(`units.${index}.assetNumber`, `Número de patrimônio ${index + 1}`, <Input {...accessibility(`units.${index}.assetNumber`)} value={unit.assetNumber} disabled={locked} onChange={(event) => updateUnit(unit.key, { assetNumber: event.target.value })} maxLength={80} placeholder="Ex.: UNI-0001" required />)}
              {field(`units.${index}.status`, `Estado da unidade ${index + 1}`, <select {...accessibility(`units.${index}.status`)} className={controlClass} value={unit.status} disabled={locked} onChange={(event) => updateUnit(unit.key, { status: event.target.value as UnitStatus })}><option value="AVAILABLE">Disponível</option><option value="MAINTENANCE">Em manutenção</option>{locked && <option value={unit.status}>{unitStatusLabels[unit.status]}</option>}</select>)}
              <Button type="button" variant="ghost" size="icon" className="mt-0 text-slate-500 sm:mt-6" aria-label={`Remover unidade ${index + 1}`} disabled={locked} onClick={() => setUnits((current) => current.filter((item) => item.key !== unit.key))}><Trash2 /></Button>
            </div>;
          })}</div>
          {errors.units && <p className="mt-2 text-xs text-rose-700">{errors.units}</p>}
        </section>}
        <div className="rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600"><div className="flex flex-wrap gap-x-5 gap-y-2"><span>Total: <strong>{Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : "—"}</strong></span><span>Disponíveis: <strong>{Number.isSafeInteger(quantity - inMaintenance - busy) ? Math.max(0, quantity - inMaintenance - busy) : "—"}</strong></span><span>Reservados: <strong>{equipment?.reserved ?? 0}</strong></span><span>Em uso: <strong>{equipment?.inUse ?? 0}</strong></span><span>Em manutenção: <strong>{Number.isSafeInteger(inMaintenance) && inMaintenance >= 0 ? inMaintenance : "—"}</strong></span></div><p className="mt-2">Reservas e retiradas são registradas separadamente e não podem ser alteradas neste cadastro.</p></div>
        {equipment && field("reason", "Motivo da alteração", <textarea {...accessibility("reason")} className={`${controlClass} min-h-20 resize-y`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Ex.: Conferência de estoque e atualização do local" required />)}
      </fieldset>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <DialogFooter className="border-t border-slate-100 pt-5"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving}>{saving && <LoaderCircle className="animate-spin" />}{saving ? "Salvando…" : equipment ? "Salvar alterações" : "Cadastrar equipamento"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
