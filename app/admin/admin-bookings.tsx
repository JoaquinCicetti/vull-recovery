"use client";

import Link from "next/link";
import { fmtDateTime } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { BookingActions } from "@/components/admin/booking-actions";
import type { BookingStatus } from "@/lib/types";

export type AdminBookingRow = {
  id: string;
  startsAt: string;
  status: BookingStatus;
  service: string;
  client: string;
  phone: string | null;
  email: string | null;
};

function Row({ b, past }: { b: AdminBookingRow; past?: boolean }) {
  return (
    <li
      className={`surface-card surface-lift flex flex-wrap items-start justify-between gap-4 p-5 ${
        past ? "opacity-60" : ""
      }`}
    >
      <div className="min-w-0">
        <p className="font-semibold text-fg">{b.service}</p>
        <p className="mt-0.5 text-sm capitalize text-fg-muted">
          {fmtDateTime(b.startsAt)}
        </p>
        <p className="mt-1 text-sm text-fg">{b.client}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-xs text-fg-faint">
          {b.email && <span className="truncate">{b.email}</span>}
          {b.phone && <span>· {b.phone}</span>}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <StatusBadge status={b.status} />
        <Link
          href={`/turno/${b.id}`}
          className="text-sm text-accent underline-offset-4 hover:underline"
        >
          Ver turno
        </Link>
        <BookingActions bookingId={b.id} status={b.status} started={Boolean(past)} />
      </div>
    </li>
  );
}

export function AdminBookings({
  upcoming,
  past,
}: {
  upcoming: AdminBookingRow[];
  past: AdminBookingRow[];
}) {
  if (upcoming.length === 0 && past.length === 0) {
    return <p className="mt-4 text-sm text-fg-faint">Todavía no hay turnos.</p>;
  }

  return (
    <div className="mt-4 flex flex-col gap-8">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-fg-faint">
          Próximos
        </p>
        {upcoming.length === 0 ? (
          <p className="mt-3 text-sm text-fg-faint">Sin turnos próximos.</p>
        ) : (
          <ul className="stagger-children mt-3 flex flex-col gap-3">
            {upcoming.map((b) => (
              <Row key={b.id} b={b} />
            ))}
          </ul>
        )}
      </div>

      {past.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-fg-faint">
            Últimos días
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {past.map((b) => (
              <Row key={b.id} b={b} past />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
