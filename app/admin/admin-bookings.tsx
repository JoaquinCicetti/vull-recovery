"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { BookingActions } from "@/components/admin/booking-actions";
import { Button } from "@/components/ui/button";
import type { BookingStatus } from "@/lib/types";

// Shared select (with the profiles!user_id disambiguation) so the server's first
// page and the client's "load more" fetch the exact same shape.
export const BOOKINGS_SELECT =
  "id, starts_at, status, services(name), profiles!user_id(full_name, whatsapp_phone, email)";

const ACTIVE = ["pending", "awaiting_payment", "confirmed"];
const PAGE = 20;

export type AdminBookingRow = {
  id: string;
  startsAt: string;
  status: BookingStatus;
  service: string;
  client: string;
  phone: string | null;
  email: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(b: any): AdminBookingRow {
  return {
    id: b.id,
    startsAt: b.starts_at,
    status: b.status,
    service: b.services?.name ?? "Servicio",
    client: b.profiles?.full_name ?? "—",
    phone: b.profiles?.whatsapp_phone ?? null,
    email: b.profiles?.email ?? null,
  };
}

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
  initialUpcoming,
  upcomingTotal,
  recent,
  recentTotal,
  nowISO,
}: {
  initialUpcoming: AdminBookingRow[];
  upcomingTotal: number;
  recent: AdminBookingRow[];
  recentTotal: number;
  nowISO: string;
}) {
  const supabase = createClient();
  const [upcoming, setUpcoming] = useState(initialUpcoming);
  const [loading, setLoading] = useState(false);
  const remaining = Math.max(0, upcomingTotal - upcoming.length);

  async function loadMore() {
    setLoading(true);
    const { data } = await supabase
      .from("bookings")
      .select(BOOKINGS_SELECT)
      .in("status", ACTIVE)
      .gte("starts_at", nowISO)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(upcoming.length, upcoming.length + PAGE - 1);
    setLoading(false);
    if (data) setUpcoming((prev) => [...prev, ...(data as any[]).map(mapRow)]);
  }

  if (upcomingTotal === 0 && recentTotal === 0) {
    return <p className="mt-4 text-sm text-fg-faint">Todavía no hay turnos.</p>;
  }

  return (
    <div className="mt-4 flex flex-col gap-8">
      <div>
        <p className="flex items-baseline gap-2 text-xs font-medium uppercase tracking-wider text-fg-faint">
          Próximos <span className="font-mono normal-case">{upcomingTotal}</span>
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
        {remaining > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={loadMore}
            disabled={loading}
          >
            {loading ? "Cargando…" : `Cargar más (${remaining})`}
          </Button>
        )}
      </div>

      {recent.length > 0 && (
        <div>
          <p className="flex items-baseline gap-2 text-xs font-medium uppercase tracking-wider text-fg-faint">
            Recientes <span className="font-mono normal-case">{recentTotal}</span>
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {recent.map((b) => (
              <Row key={b.id} b={b} past />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
