import { SearchX } from "lucide-react";

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center" role="status">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
        <SearchX className="size-5" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-slate-500">{description}</p>
    </div>
  );
}
