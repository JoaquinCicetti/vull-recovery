"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ActiveFilter = { key: string; label: string; clearHref: string };

// The filters of a query-string-driven list, out of the way in a dialog. The
// fields inside are plain form controls named after the URL params; submitting
// navigates to `basePath` with the non-empty values (page resets). `keep` are
// params the dialog does not edit but must not drop (the sector, the view).
export function FilterDialog({
  basePath,
  keep = {},
  active,
  clearHref,
  title = "Filtrar",
  description,
  children,
}: {
  basePath: string;
  keep?: Record<string, string | undefined>;
  active: ActiveFilter[];
  clearHref: string;
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) qs.set(k, v);
    for (const [k, v] of new FormData(e.currentTarget).entries()) {
      const s = String(v).trim();
      if (s) qs.set(k, s);
    }
    const s = qs.toString();
    setOpen(false);
    router.push(s ? `${basePath}?${s}` : basePath);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <SlidersHorizontal data-icon="inline-start" aria-hidden />
            {title}
            {active.length > 0 && (
              <span className="font-mono text-[11px] text-accent">{active.length}</span>
            )}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <form onSubmit={submit} className="flex flex-col gap-4">
            {children}
            <DialogFooter className="mt-2">
              {active.length > 0 && (
                <Button asChild variant="ghost" className="text-fg-muted">
                  <Link href={clearHref} onClick={() => setOpen(false)}>
                    Limpiar
                  </Link>
                </Button>
              )}
              <Button type="submit">Aplicar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {active.map((f) => (
        <Link
          key={f.key}
          href={f.clearHref}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 pr-1.5 pl-2.5 text-xs text-fg transition-colors hover:border-accent/60",
          )}
          aria-label={`Quitar filtro: ${f.label}`}
        >
          {f.label}
          <X className="size-3.5 text-fg-faint" aria-hidden />
        </Link>
      ))}
    </div>
  );
}

// A labelled control inside the dialog. Native selects/inputs keep the house
// look through FIELD; the label sits above so a phone keyboard never hides it.
export function FilterField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5 text-xs text-fg-muted">
      {label}
      {children}
    </label>
  );
}
