import Link from "next/link";
import { Check, ChevronRight, MessageSquareHeart } from "lucide-react";
import { fmtDateParts } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import type { BookingStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export type AccountBooking = {
  id: string;
  startsAt: string;
  status: BookingStatus;
  service: string;
  holdExpiresAt: string | null;
  /** A class of an abono (paid with the month, moved instead of cancelled). */
  membership?: boolean;
  /** Sector and bed, e.g. "Pilates · Cama 2". */
  place?: string | null;
  /** Post-session survey of a past session: to answer, answered, or not offered. */
  survey?: "pending" | "done" | null;
};

// The date as an instrument readout: big day number over a short month.
export function DateTile({ iso, dim }: { iso: string; dim?: boolean }) {
  const { day, month } = fmtDateParts(iso);
  return (
    <div
      className={cn(
        "flex size-14 shrink-0 flex-col items-center justify-center rounded-md border border-border bg-surface-2",
        dim && "opacity-60",
      )}
    >
      <span className="font-mono text-xl font-bold leading-none tabular-nums text-fg">
        {day}
      </span>
      <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
        {month}
      </span>
    </div>
  );
}

// The row is one link to the turno; the survey is a second link, so it sits
// under the row as its footer instead of inside it.
export function BookingRow({ b, dim }: { b: AccountBooking; dim?: boolean }) {
  if (!b.survey) return <RowLink b={b} dim={dim} />;
  return (
    <div>
      <RowLink b={b} dim={dim} className="rounded-b-none" />
      {b.survey === "pending" ? (
        <Link
          href={`/encuesta/${b.id}`}
          className="group flex items-center gap-2 rounded-b-lg border border-t-0 border-border bg-surface-2/60 px-4 py-2.5 text-sm font-medium text-fg transition-colors duration-150 hover:border-accent/50"
        >
          <MessageSquareHeart className="size-4 shrink-0 text-accent" aria-hidden />
          <span className="flex-1">Completar encuesta</span>
          <ChevronRight
            className="size-4 shrink-0 text-fg-faint transition-transform duration-150 group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
      ) : (
        <p className="flex items-center gap-2 rounded-b-lg border border-t-0 border-border bg-surface-2/40 px-4 py-2 text-xs text-fg-faint">
          <Check className="size-3.5 shrink-0" aria-hidden />
          Encuesta respondida
        </p>
      )}
    </div>
  );
}

function RowLink({ b, dim, className }: { b: AccountBooking; dim?: boolean; className?: string }) {
  const { weekday, time } = fmtDateParts(b.startsAt);
  return (
    <Link
      href={`/turno/${b.id}`}
      className={cn(
        "surface-card surface-lift group flex items-center gap-4 p-4 transition-colors duration-150 hover:border-border-strong",
        className,
      )}
    >
      <DateTile iso={b.startsAt} dim={dim} />
      <div className="min-w-0 flex-1">
        <p className={cn("flex items-center gap-2 font-semibold leading-snug", dim ? "text-fg-muted" : "text-fg")}>
          <span className="truncate">{b.service}</span>
          {b.membership && (
            <span className="shrink-0 rounded border border-border px-1 font-mono text-[10px] font-normal uppercase tracking-wider text-fg-faint">
              Abono
            </span>
          )}
        </p>
        <p className="mt-0.5 text-sm text-fg-muted">
          <span className="capitalize">{weekday}</span>
          {" · "}
          <span className="font-mono tabular-nums">{time}</span>
          {b.place && <span className="text-fg-faint"> · {b.place}</span>}
        </p>
        {/* On a phone the badge sits under the text so the plan name keeps the row. */}
        <StatusBadge status={b.status} className="mt-2 sm:hidden" />
      </div>
      <StatusBadge status={b.status} className="hidden sm:inline-flex" />
      <ChevronRight
        className="size-4 shrink-0 text-fg-faint transition-transform duration-150 group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}
