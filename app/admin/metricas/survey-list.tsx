"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { fmtDateParts } from "@/lib/format";
import { SurveyResponseDialog } from "@/components/admin/survey-response-dialog";
import { cn } from "@/lib/utils";

export type SurveyListItem = {
  id: string;
  submittedAt: string;
  client: string;
  service: string;
  experience: number;
  nps: number;
};

/** Recent answers as rows; a row opens every answer. `openId` (from a notice's link) opens one on arrival. */
export function SurveyList({ items, openId }: { items: SurveyListItem[]; openId: string | null }) {
  const [open, setOpen] = useState<string | null>(openId);
  if (items.length === 0) {
    return <p className="mt-3 text-sm text-fg-faint">Sin respuestas en el período.</p>;
  }
  return (
    <>
      <ul className="surface-card mt-3 divide-y divide-border">
        {items.map((r) => {
          const { weekday, day, month } = fmtDateParts(r.submittedAt);
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setOpen(r.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/60"
              >
                <span className="w-16 shrink-0 font-mono text-xs capitalize text-fg-faint">
                  {weekday} {day} {month}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-fg">{r.client}</span>
                  {r.service && <span className="block truncate text-xs text-fg-muted">{r.service}</span>}
                </span>
                <Pill label="Exp" n={r.experience} always />
                <Pill label="Rec" n={r.nps} />
                <ChevronRight className="size-4 shrink-0 text-fg-faint" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <SurveyResponseDialog surveyId={open} open={open != null} onOpenChange={(o) => !o && setOpen(null)} />
    </>
  );
}

function Pill({ label, n, always }: { label: string; n: number; always?: boolean }) {
  return (
    <span
      className={cn(
        always ? "inline" : "hidden sm:inline",
        "shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-xs tabular-nums",
        n >= 9 ? "border-accent/40 text-fg" : n <= 6 ? "border-danger/40 text-fg-muted" : "border-border text-fg-muted",
      )}
    >
      {label} {n}
    </span>
  );
}
