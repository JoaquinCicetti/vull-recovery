"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { fmtTime, localDate } from "@/lib/format";
import { WEEK_ORDER, WEEKDAY_SHORT } from "@/lib/membership";
import { cn } from "@/lib/utils";

export type GridBooking = {
  id: string;
  startsAt: string;
  resourceId: string;
  status: string;
  client: string;
  membership: { locked: boolean } | null;
  /** An admin block (a name, no client): never a link to a turno page. */
  block?: boolean;
};

// Who holds each bed this week. From `sm` up: beds down, weekdays across.
// On a phone a 7-column table only scrolls sideways, so there the week is a
// row of day chips and one bed-by-bed list for the chosen day. Abono classes
// carry a lock when the schedule is fixed; unpaid ones read in amber.
export function BedWeekGrid({
  beds,
  days,
  bookings,
  today,
  tz,
}: {
  beds: { id: string; name: string }[];
  /** The 7 local dates of the week, Monday first. */
  days: string[];
  bookings: GridBooking[];
  today: string;
  tz: string;
}) {
  const [day, setDay] = useState(days.includes(today) ? today : days[0]);
  const cell = (bedId: string, date: string) =>
    bookings
      .filter((b) => b.resourceId === bedId && localDate(b.startsAt, tz) === date)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const dayCount = (date: string) =>
    bookings.filter((b) => localDate(b.startsAt, tz) === date).length;

  if (beds.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-fg-faint">
        Este sector no tiene camas activas. Agregalas en Ajustes.
      </p>
    );
  }

  return (
    <>
      {/* Phone: day chips + the chosen day's beds. */}
      <div className="sm:hidden">
        <div className="grid grid-cols-7 gap-1" role="tablist" aria-label="Día de la semana">
          {days.map((d, i) => {
            const sel = d === day;
            const n = dayCount(d);
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={sel}
                onClick={() => setDay(d)}
                className={cn(
                  "flex flex-col items-center rounded-md border py-1.5 text-xs transition-colors",
                  sel
                    ? "border-accent bg-accent/10 text-fg"
                    : "border-border text-fg-muted hover:border-border-strong",
                  d === today && !sel && "text-accent",
                )}
              >
                <span className="font-medium">{WEEKDAY_SHORT[WEEK_ORDER[i]]}</span>
                <span className="font-mono text-[11px] tabular-nums">{Number(d.slice(8))}</span>
                <span
                  className={cn(
                    "mt-0.5 size-1 rounded-full",
                    n > 0 ? (sel ? "bg-accent" : "bg-fg-faint") : "bg-transparent",
                  )}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>
        <ul className="surface-card mt-3 divide-y divide-border">
          {beds.map((bed) => {
            const items = cell(bed.id, day);
            return (
              <li key={bed.id} className="flex gap-3 px-3 py-2.5">
                <span className="w-16 shrink-0 pt-0.5 text-sm font-medium text-fg">{bed.name}</span>
                {items.length === 0 ? (
                  <span className="text-sm text-fg-faint">Libre</span>
                ) : (
                  <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
                    {items.map((b) => (
                      <li key={b.id}>
                        <Cell b={b} tz={tz} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Desktop: the week at a glance. */}
      <div className="surface-card hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[640px] border-collapse text-xs">
          <thead>
            <tr>
              <th className="w-20 border-b border-border px-3 py-2 text-left font-mono font-normal uppercase tracking-wider text-fg-faint">
                Cama
              </th>
              {days.map((d, i) => (
                <th
                  key={d}
                  className={cn(
                    "border-b border-border px-2 py-2 text-left font-medium",
                    d === today ? "text-accent" : "text-fg-muted",
                  )}
                >
                  {WEEKDAY_SHORT[WEEK_ORDER[i]]} {Number(d.slice(8))}
                  {d === today && <span className="ml-1 font-normal">· hoy</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {beds.map((bed) => (
              <tr key={bed.id} className="align-top">
                <th className="border-b border-border px-3 py-2 text-left font-medium text-fg">
                  {bed.name}
                </th>
                {days.map((d) => {
                  const items = cell(bed.id, d);
                  return (
                    <td key={d} className="border-b border-l border-border px-2 py-1.5">
                      {items.length === 0 ? (
                        <span className="text-fg-faint">—</span>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {items.map((b) => (
                            <li key={b.id}>
                              <Cell b={b} tz={tz} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Cell({ b, tz }: { b: GridBooking; tz: string }) {
  if (b.block) {
    return (
      <span className="flex items-center gap-1 text-xs text-fg-muted" title="Horario bloqueado">
        <span className="font-mono tabular-nums">{fmtTime(b.startsAt, tz)}</span>
        <span className="truncate">{b.client}</span>
        <span className="shrink-0 rounded border border-border px-1 font-mono text-[9px] uppercase tracking-wider text-fg-faint">
          bloq.
        </span>
      </span>
    );
  }
  return (
    <Link
      href={`/turno/${b.id}`}
      className={cn(
        "flex items-center gap-1 text-xs underline-offset-2 hover:underline sm:text-xs",
        b.status === "confirmed" ? "text-fg" : "text-amber-300",
      )}
    >
      <span className="font-mono tabular-nums text-fg-muted">{fmtTime(b.startsAt, tz)}</span>
      <span className="truncate">{b.client}</span>
      {b.membership?.locked && (
        <>
          <Lock className="size-3 shrink-0 text-accent" aria-hidden />
          <span className="sr-only">horario fijo</span>
        </>
      )}
      {b.status !== "confirmed" && <span className="shrink-0 text-[10px]">sin pagar</span>}
    </Link>
  );
}
