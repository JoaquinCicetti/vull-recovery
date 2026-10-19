"use client";

import Link from "next/link";
import { Lock, MessageCircle } from "lucide-react";
import { fmtTime, fmtDayLabel, fmtDateParts, localDate } from "@/lib/format";
import { formatARS } from "@/lib/site";
import { StatusBadge } from "@/components/status-badge";
import { BookingActions } from "@/components/admin/booking-actions";
import { cn } from "@/lib/utils";
import type { AdminBookingRow } from "./bookings-select";

function waHref(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

function groupByDay(rows: AdminBookingRow[]): { date: string; rows: AdminBookingRow[] }[] {
  const groups: { date: string; rows: AdminBookingRow[] }[] = [];
  for (const r of rows) {
    const date = localDate(r.startsAt);
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.rows.push(r);
    else groups.push({ date, rows: [r] });
  }
  return groups;
}

// A block holds the slot under a name: no client, no money, no status to
// speak of beyond "taken". It gets its own neutral tag instead of a status.
function BlockTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-auto items-center gap-1 rounded-md bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg-muted",
        className,
      )}
    >
      <Lock className="size-3" aria-hidden />
      Bloqueado
    </span>
  );
}

// One turno as a row, not a card: time | who · what | status | menu. The
// status badge already says whether it is paid (confirmed = paid, there is
// no other way to be confirmed), so nothing repeats it. On a phone the badge
// drops under the text; the menu stays at the right edge.
function Row({ b, past }: { b: AdminBookingRow; past?: boolean }) {
  const wa = waHref(b.phone);
  const { weekday, day, month } = fmtDateParts(b.startsAt);
  const summary = `${weekday} ${day} ${month} · ${fmtTime(b.startsAt)} · ${b.client}`;
  const isBlock = b.block != null;
  const gone = !["pending", "awaiting_payment", "confirmed"].includes(b.status);
  return (
    <li
      className={cn(
        "flex items-start gap-3 px-3 py-3 sm:items-center sm:gap-4 sm:px-4",
        (past || (isBlock && gone)) && "opacity-60",
      )}
    >
      <span className="w-12 shrink-0 pt-0.5 font-mono text-sm font-semibold tabular-nums text-fg sm:pt-0">
        {fmtTime(b.startsAt)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2">
          {isBlock || !b.userId ? (
            <span className="truncate font-medium text-fg">{b.client}</span>
          ) : (
            <Link
              href={`/admin/clientes/${b.userId}`}
              className="truncate font-medium text-fg underline-offset-4 hover:underline"
            >
              {b.client}
            </Link>
          )}
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`WhatsApp a ${b.client}`}
              className="shrink-0 text-fg-faint transition-colors hover:text-accent"
            >
              <MessageCircle className="size-3.5" aria-hidden />
            </a>
          )}
        </p>
        <p className="mt-0.5 truncate text-sm text-fg-muted">
          {isBlock ? (
            <>
              Horario bloqueado
              {b.place && <span className="text-fg-faint"> · {b.place}</span>}
            </>
          ) : (
            <>
              {b.service}
              {b.place && <span className="text-fg-faint"> · {b.place}</span>}
              {b.membership ? (
                <span className="text-fg-faint"> · Abono{b.membership.locked ? " fijo" : ""}</span>
              ) : (
                b.price != null && (
                  <span className="font-mono text-fg-faint"> · {formatARS(b.price)}</span>
                )
              )}
            </>
          )}
        </p>
        {isBlock ? (
          gone ? (
            <StatusBadge status={b.status} className="mt-2 sm:hidden" />
          ) : (
            <BlockTag className="mt-2 sm:hidden" />
          )
        ) : (
          <StatusBadge status={b.status} className="mt-2 sm:hidden" />
        )}
        {b.membership && b.status === "pending" && (
          <p className="mt-1 text-xs text-amber-300">Cuota del mes sin pagar</p>
        )}
      </div>
      {isBlock && !gone ? (
        <BlockTag className="hidden shrink-0 sm:inline-flex" />
      ) : (
        <StatusBadge status={b.status} className="hidden shrink-0 sm:inline-flex" />
      )}
      <div className="-mr-1 shrink-0">
        <BookingActions
          bookingId={b.id}
          serviceId={b.serviceId}
          status={b.status}
          started={Boolean(past)}
          membership={Boolean(b.membership)}
          block={isBlock}
          summary={summary}
        />
      </div>
    </li>
  );
}

// Turnos grouped by local day, in time order. Each day is one bordered list
// with its date and count as the header; a turno whose time has passed is
// dimmed and gets the "after the fact" action (no-show) instead of the live ones.
export function BookingList({
  rows,
  nowISO,
  empty = "Sin turnos.",
}: {
  rows: AdminBookingRow[];
  nowISO: string;
  empty?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-fg-faint">
        {empty}
      </p>
    );
  }
  const now = new Date(nowISO).getTime();
  const today = localDate(nowISO);
  return (
    <div className="flex flex-col gap-5">
      {groupByDay(rows).map((g) => (
        <section key={g.date}>
          <h3 className="sticky top-0 z-[1] flex items-baseline justify-between gap-3 bg-bg/90 py-1.5 backdrop-blur">
            <span
              className={cn(
                "text-sm font-semibold capitalize",
                g.date === today ? "text-accent" : "text-fg",
              )}
            >
              {fmtDayLabel(g.date)}
              {g.date === today && <span className="font-normal"> · hoy</span>}
            </span>
            <span className="font-mono text-xs tabular-nums text-fg-faint">
              {g.rows.length} {g.rows.length === 1 ? "turno" : "turnos"}
            </span>
          </h3>
          <ul className="surface-card mt-1.5 divide-y divide-border">
            {g.rows.map((b) => (
              <Row key={b.id} b={b} past={new Date(b.startsAt).getTime() < now} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
