import Link from "next/link";
import { ChevronRight } from "lucide-react";
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

export function BookingRow({ b, dim }: { b: AccountBooking; dim?: boolean }) {
  const { weekday, time } = fmtDateParts(b.startsAt);
  return (
    <Link
      href={`/turno/${b.id}`}
      className="surface-card surface-lift group flex items-center gap-4 p-4 transition-colors duration-150 hover:border-border-strong"
    >
      <DateTile iso={b.startsAt} dim={dim} />
      <div className="min-w-0 flex-1">
        <p className={cn("font-semibold leading-snug", dim ? "text-fg-muted" : "text-fg")}>
          {b.service}
        </p>
        <p className="mt-0.5 text-sm text-fg-muted">
          <span className="capitalize">{weekday}</span>
          {" · "}
          <span className="font-mono tabular-nums">{time}</span>
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
