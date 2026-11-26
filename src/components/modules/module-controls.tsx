"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="relative min-w-0 flex-1 md:min-w-60">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
      <Input aria-label={placeholder} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} className="bg-white pl-9" />
    </div>
  );
}

export function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-sm text-slate-600">
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-8 text-sm text-slate-700 shadow-xs outline-none transition focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 md:w-auto">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function SummaryCard({ title, value, description, icon, tone = "blue" }: { title: string; value: ReactNode; description: string; icon: ReactNode; tone?: "blue" | "green" | "amber" | "slate" }) {
  const colors = { blue: "bg-blue-50 text-blue-600", green: "bg-emerald-50 text-emerald-600", amber: "bg-amber-50 text-amber-600", slate: "bg-slate-100 text-slate-500" };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${colors[tone]}`} aria-hidden="true">{icon}</span>
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </div>
  );
}

export function ModuleTable({ columns, children }: { columns: { key: string; label: string; className?: string }[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-180 border-collapse text-left text-sm">
        <thead><tr className="border-y border-slate-100 bg-slate-50/70">{columns.map((column) => <th key={column.key} scope="col" className={`px-5 py-3 text-xs font-medium text-slate-500 ${column.className ?? ""}`}>{column.label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-1 text-sm leading-relaxed text-slate-800">{children}</dd></div>;
}

export function ResultCount({ count, singular, plural, gender = "masculine" }: { count: number; singular: string; plural: string; gender?: "masculine" | "feminine" }) {
  const ending = gender === "feminine" ? "a" : "o";
  return <p className="text-xs text-slate-500">{count} {count === 1 ? singular : plural} encontrad{ending}{count === 1 ? "" : "s"}</p>;
}
