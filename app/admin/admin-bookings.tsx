"use client";

import { fmtDateTime } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { CancelBooking } from "@/components/cancel-booking";
import type { BookingStatus } from "@/lib/types";

export type AdminBookingRow = {
  id: string;
  startsAt: string;
  status: BookingStatus;
  service: string;
  client: string;
  phone: string | null;
};

export function AdminBookings({ bookings }: { bookings: AdminBookingRow[] }) {
  if (bookings.length === 0) {
    return <p className="mt-4 text-sm text-fg-faint">Sin turnos próximos.</p>;
  }

  return (
    <ul className="stagger-children mt-4 flex flex-col gap-3">
      {bookings.map((b) => (
        <li
          key={b.id}
          className="surface-card surface-lift flex flex-wrap items-start justify-between gap-4 p-5"
        >
          <div>
            <p className="font-semibold text-fg">{b.service}</p>
            <p className="mt-0.5 text-sm capitalize text-fg-muted">
              {fmtDateTime(b.startsAt)}
            </p>
            <p className="mt-0.5 text-sm text-fg-faint">
              {b.client}
              {b.phone ? ` · ${b.phone}` : ""}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <StatusBadge status={b.status} />
            <CancelBooking
              bookingId={b.id}
              label="Cancelar"
              confirmPrompt="¿Cancelar el turno de este cliente?"
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
