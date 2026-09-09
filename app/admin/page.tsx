import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminPayments } from "./admin-payments";
import { AdminBookings, type AdminBookingRow } from "./admin-bookings";
import { BOOKINGS_SELECT } from "./bookings-select";
import { PushManager } from "@/components/push-manager";
import { PageShell } from "@/components/ui/page-shell";
import { Button } from "@/components/ui/button";
import type { BookingStatus } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const PAGE = 20;
const ACTIVE = ["pending", "awaiting_payment", "confirmed"];

function mapBooking(b: any): AdminBookingRow {
  return {
    id: b.id as string,
    startsAt: b.starts_at as string,
    status: b.status as BookingStatus,
    serviceId: b.service_id as string,
    service: b.services?.name ?? "Servicio",
    price: (b.services?.price_ars as number) ?? null,
    client: b.profiles?.full_name ?? "—",
    phone: (b.profiles?.whatsapp_phone as string) ?? null,
    email: (b.profiles?.email as string) ?? null,
  };
}

export default async function AdminPage() {
  await requireAdmin();
  const supabase = await createClient();

  // Surfaced in the UI: a swallowed error here is exactly why the lists can look
  // empty when they shouldn't (e.g. an RLS or schema problem).
  const loadErrors: string[] = [];

  // ── Payments needing a human (bounded; receipts fetched lazily on click) ───
  // Manual receipts waiting for approval, PLUS any Talo payment the settle path
  // could not resolve on its own (underpaid, unverifiable, paid without a slot,
  // reversed…). Filtering on provider='manual' here used to make those invisible.
  const {
    data: rawPayments,
    count: paymentsCount,
    error: paymentsError,
  } = await supabase
    .from("payments")
    .select(
      // `profiles!user_id` disambiguates bookings' two FKs to profiles.
      "id, amount_ars, receipt_path, provider, status, admin_flag, reversed_at, kind, services(name), bookings(starts_at, services(name), profiles!user_id(full_name, whatsapp_phone))",
      { count: "exact" },
    )
    .in("provider", ["manual", "talo"])
    .or("status.eq.pending,admin_flag.not.is.null,reversed_at.not.is.null")
    .order("created_at", { ascending: true })
    .limit(50);
  if (paymentsError) loadErrors.push(`Pagos: ${paymentsError.message}`);

  const payments = ((rawPayments ?? []) as any[]).map((p) => ({
    id: p.id as string,
    amount: p.amount_ars as number,
    receiptPath: (p.receipt_path as string) ?? null,
    provider: (p.provider as "manual" | "talo") ?? "manual",
    status: (p.status as "pending" | "approved" | "rejected") ?? "pending",
    adminFlag: (p.admin_flag as string) ?? null,
    reversed: Boolean(p.reversed_at),
    service:
      p.bookings?.services?.name ??
      (p.kind === "pack" ? `Pack · ${p.services?.name ?? ""}`.trim() : "Servicio"),
    when: (p.bookings?.starts_at as string) ?? null,
    client: p.bookings?.profiles?.full_name ?? "—",
    phone: (p.bookings?.profiles?.whatsapp_phone as string) ?? null,
  }));

  // ── Bookings: actionable upcoming (active only, paginated) + recent past ────
  // Splitting by status keeps cancelled/expired/no-show turns out of the live
  // "Próximos" list; the browser paginates upcoming via `range` from the client.
  // eslint-disable-next-line react-hooks/purity -- server component: renders once
  const now = Date.now();
  const nowISO = new Date(now).toISOString();
  const recentSince = new Date(now - 21 * 86400000).toISOString();

  const [upRes, recentRes] = await Promise.all([
    supabase
      .from("bookings")
      .select(BOOKINGS_SELECT, { count: "exact" })
      .in("status", ACTIVE)
      .gte("starts_at", nowISO)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(0, PAGE - 1),
    supabase
      .from("bookings")
      .select(BOOKINGS_SELECT, { count: "exact" })
      .lt("starts_at", nowISO)
      .gte("starts_at", recentSince)
      .order("starts_at", { ascending: false })
      .order("id", { ascending: true })
      .range(0, PAGE - 1),
  ]);
  if (upRes.error) loadErrors.push(`Turnos: ${upRes.error.message}`);
  if (recentRes.error) loadErrors.push(`Recientes: ${recentRes.error.message}`);

  const upcoming = ((upRes.data ?? []) as any[]).map(mapBooking);
  const recent = ((recentRes.data ?? []) as any[]).map(mapBooking);

  return (
    <PageShell
      size="wide"
      eyebrow="Panel"
      title="Administración"
      actions={
        <>
          <Button asChild variant="outline">
            <Link href="/admin/configuracion">Disponibilidad</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/servicios">Planes y precios</Link>
          </Button>
        </>
      }
    >
      {loadErrors.length > 0 && (
        <div className="mb-8 rounded-md border border-danger/30 bg-danger/5 p-4">
          <p className="text-sm font-semibold text-danger">
            No se pudieron cargar algunos datos
          </p>
          <ul className="mt-1 list-disc pl-5 font-mono text-xs text-fg-muted">
            {loadErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-8">
        <PushManager />
      </div>

      <section>
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
          Pagos por revisar
        </h2>
        <AdminPayments
          payments={payments}
          total={paymentsCount ?? payments.length}
        />
      </section>

      <section className="mt-12">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
          Turnos
        </h2>
        <AdminBookings
          initialUpcoming={upcoming}
          upcomingTotal={upRes.count ?? upcoming.length}
          recent={recent}
          recentTotal={recentRes.count ?? recent.length}
          nowISO={nowISO}
        />
      </section>
    </PageShell>
  );
}
