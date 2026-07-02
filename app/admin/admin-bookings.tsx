"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { fmtTime, fmtDayLabel, localDate } from "@/lib/format";
import { formatARS } from "@/lib/site";
import { StatusBadge } from "@/components/status-badge";
import { BookingActions } from "@/components/admin/booking-actions";
import { Button } from "@/components/ui/button";
import { BOOKINGS_SELECT } from "./bookings-select";
import type { BookingStatus } from "@/lib/types";

const ACTIVE = ["pending", "awaiting_payment", "confirmed"];
const PAGE = 20;

export type AdminBookingRow = {
  id: string;
  startsAt: string;
  status: BookingStatus;
  serviceId: string;
  service: string;
  price: number | null;
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
    serviceId: b.service_id,
    service: b.services?.name ?? "Servicio",
    price: b.services?.price_ars ?? null,
    client: b.profiles?.full_name ?? "—",
    phone: b.profiles?.whatsapp_phone ?? null,
    email: b.profiles?.email ?? null,
  };
}

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
          <p className="mt-1 text-sm text-fg">{b.client}</p>
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

function DayGroups({ rows, past }: { rows: AdminBookingRow[]; past?: boolean }) {
  return (
    <div className="mt-3 flex flex-col gap-6">
      {groupByDay(rows).map((g) => (
        <div key={g.date}>
          <p className="sticky top-0 z-[1] bg-bg/90 py-1 text-sm font-medium capitalize text-fg-muted backdrop-blur">
            {fmtDayLabel(g.date)}
          </p>
          <ul className="mt-2 flex flex-col gap-3">
            {g.rows.map((b) => (
              <Row key={b.id} b={b} past={past} />
            ))}
          </ul>
        </div>
      ))}
    </div>
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
          <DayGroups rows={upcoming} />
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
          <DayGroups rows={recent} past />
        </div>
      )}
    </div>
  );
}
