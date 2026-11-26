import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: number;
  detail: string;
  label: string;
  icon: LucideIcon;
  color: "blue" | "teal" | "amber" | "violet";
  href: string;
}

const colors = { blue: "bg-blue-50 text-blue-600", teal: "bg-teal-50 text-teal-600", amber: "bg-amber-50 text-amber-600", violet: "bg-violet-50 text-violet-600" };

export function StatCard({ title, value, detail, label, icon: Icon, color, href }: StatCardProps) {
  return <Card className="group relative overflow-hidden p-5 shadow-none transition-shadow hover:shadow-md"><div className="flex items-center justify-between"><p className="text-xs font-medium text-slate-500">{title}</p><span className={cn("flex size-9 items-center justify-center rounded-[10px]", colors[color])}><Icon className="size-[18px]" strokeWidth={1.7} /></span></div><div className="mt-2 flex items-baseline gap-2"><span className="text-[34px] font-semibold leading-tight tracking-[-0.045em] text-slate-800">{value.toLocaleString("pt-BR")}</span><span className="text-[11px] text-slate-500">{label}</span></div><div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3"><span className="text-[11px] text-slate-500">{detail}</span><Link href={href} aria-label={`Ver ${title.toLocaleLowerCase("pt-BR")}`} className="rounded p-0.5 text-slate-500 hover:bg-blue-50 hover:text-blue-600"><ArrowUpRight className="size-3.5" /></Link></div></Card>;
}
