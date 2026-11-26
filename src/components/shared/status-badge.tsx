import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  confirmado: "border-emerald-200/70 bg-emerald-50 text-emerald-700",
  confirmada: "border-emerald-200/70 bg-emerald-50 text-emerald-700",
  aprovado: "border-emerald-200/70 bg-emerald-50 text-emerald-700",
  aprovada: "border-emerald-200/70 bg-emerald-50 text-emerald-700",
  disponível: "border-emerald-200/70 bg-emerald-50 text-emerald-700",
  concluído: "border-emerald-200/70 bg-emerald-50 text-emerald-700",
  concluída: "border-emerald-200/70 bg-emerald-50 text-emerald-700",
  devolvido: "border-emerald-200/70 bg-emerald-50 text-emerald-700",
  devolvida: "border-emerald-200/70 bg-emerald-50 text-emerald-700",
  pendente: "border-amber-200/70 bg-amber-50 text-amber-700",
  "em análise": "border-amber-200/70 bg-amber-50 text-amber-700",
  "aguardando aprovação": "border-amber-200/70 bg-amber-50 text-amber-700",
  "em planejamento": "border-amber-200/70 bg-amber-50 text-amber-700",
  planejamento: "border-amber-200/70 bg-amber-50 text-amber-700",
  manutenção: "border-amber-200/70 bg-amber-50 text-amber-700",
  "em manutenção": "border-amber-200/70 bg-amber-50 text-amber-700",
  reservado: "border-blue-200/70 bg-blue-50 text-blue-700",
  reservada: "border-blue-200/70 bg-blue-50 text-blue-700",
  agendado: "border-blue-200/70 bg-blue-50 text-blue-700",
  agendada: "border-blue-200/70 bg-blue-50 text-blue-700",
  prevista: "border-blue-200/70 bg-blue-50 text-blue-700",
  "em andamento": "border-blue-200/70 bg-blue-50 text-blue-700",
  "em uso": "border-blue-200/70 bg-blue-50 text-blue-700",
  retirado: "border-blue-200/70 bg-blue-50 text-blue-700",
  retirada: "border-blue-200/70 bg-blue-50 text-blue-700",
  cancelado: "border-slate-200 bg-slate-100 text-slate-600",
  cancelada: "border-slate-200 bg-slate-100 text-slate-600",
  rascunho: "border-slate-200 bg-slate-100 text-slate-600",
  atrasado: "border-rose-200/70 bg-rose-50 text-rose-700",
  atrasada: "border-rose-200/70 bg-rose-50 text-rose-700",
  atraso: "border-rose-200/70 bg-rose-50 text-rose-700",
  "em atraso": "border-rose-200/70 bg-rose-50 text-rose-700",
  recusado: "border-rose-200/70 bg-rose-50 text-rose-700",
  recusada: "border-rose-200/70 bg-rose-50 text-rose-700",
  indisponível: "border-rose-200/70 bg-rose-50 text-rose-700",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-md",
        statusColors[status.trim().toLocaleLowerCase("pt-BR")] ??
          "border-slate-200 bg-slate-50 text-slate-600",
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-75" aria-hidden="true" />
      {status}
    </Badge>
  );
}
