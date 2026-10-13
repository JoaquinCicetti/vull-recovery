"use client";

import Link from "next/link";
import { fmtTime, fmtDayLabel, localDate } from "@/lib/format";
import { formatARS } from "@/lib/site";
import { StatusBadge } from "@/components/status-badge";
import { BookingActions } from "@/components/admin/booking-actions";
import type { AdminBookingRow } from "./bookings-select";
import type { BookingStatus } from "@/lib/types";

// A confirmed turno reads as paid; the pre-confirm states show their payment step.
function paymentHint(status: BookingStatus): string | null {
  if (status === "confirmed") return "Pagado";
  if (status === "awaiting_payment") return "Pago a verificar";
  if (status === "pending") return "Sin pagar";
  return null;
}

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

function Row({ b, past }: { b: AdminBookingRow; past?: boolean }) {
  const wa = waHref(b.phone);
  const hint = paymentHint(b.status);
  return (
    <li
      className={`surface-card surface-lift flex flex-wrap items-start justify-between gap-4 p-5 ${
        past ? "opacity-60" : ""
      }`}
    >
      <div className="flex min-w-0 gap-4">
        <span className="font-mono text-sm tabular-nums text-fg-muted">
          {fmtTime(b.startsAt)}
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-fg">
            {b.service}
            {b.price != null && (
              <span className="ml-2 font-mono text-sm font-normal text-fg-faint">
                {formatARS(b.price)}
              </span>
            )}
          </p>
          <p className="mt-1 text-sm">
            <Link
              href={`/admin/clientes/${b.userId}`}
              className="text-fg underline-offset-4 hover:underline"
            >
              {b.client}
            </Link>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-xs text-fg-faint">
            {b.email && <span className="truncate">{b.email}</span>}
            {wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline-offset-4 hover:underline"
              >
                {b.phone}
              </a>
            ) : (
              b.phone && <span>· {b.phone}</span>
            )}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <StatusBadge status={b.status} />
        {hint && <span className="text-xs text-fg-faint">{hint}</span>}
        <Link
          href={`/turno/${b.id}`}
          className="text-sm text-accent underline-offset-4 hover:underline"
        >
          Ver turno
        </Link>
        <BookingActions
          bookingId={b.id}
          serviceId={b.serviceId}
          status={b.status}
          started={Boolean(past)}
        />
      </div>
    </li>
  );
}

// Turnos grouped by local day. A turno whose time has passed is dimmed and gets
// the "after the fact" actions (no-show) instead of the live ones.
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
    return <p className="mt-4 text-sm text-fg-faint">{empty}</p>;
  }
  const now = new Date(nowISO).getTime();
  return (
    <div className="mt-3 flex flex-col gap-6">
      {groupByDay(rows).map((g) => (
        <div key={g.date}>
          <p className="sticky top-0 z-[1] bg-bg/90 py-1 text-sm font-medium capitalize text-fg-muted backdrop-blur">
            {fmtDayLabel(g.date)}
          </p>
          <ul className="mt-2 flex flex-col gap-3">
            {g.rows.map((b) => (
              <Row key={b.id} b={b} past={new Date(b.startsAt).getTime() < now} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
