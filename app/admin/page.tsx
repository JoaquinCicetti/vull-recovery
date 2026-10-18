import Link from "next/link";
import { MEMBERSHIP_ACTIVE } from "@/lib/booking-status";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/format";
import { AdminPayments } from "./admin-payments";
import { OverduePeriods, type OverdueRow } from "@/components/admin/overdue-periods";
import { BookingList } from "./admin-bookings";
import { BOOKINGS_SELECT, mapBooking } from "./bookings-select";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { LoadErrors } from "@/components/admin/load-errors";
import { SectionTitle, Stat } from "@/components/admin/stat";
import { PushManager } from "@/components/push-manager";
import { PageShell } from "@/components/ui/page-shell";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Inicio shows what needs attention now: payments to review and the coming
// week. Everything else (history, filters, search) lives in the Turnos tab.
const WEEK_LIMIT = 40;
const ACTIVE = ["pending", "awaiting_payment", "confirmed"];

export default async function AdminPage() {
  await requireAdmin();
  const supabase = await createClient();
  const loadErrors: string[] = [];

  // eslint-disable-next-line react-hooks/purity -- server component: renders once
  const now = Date.now();
  const nowISO = new Date(now).toISOString();
  const weekISO = new Date(now + 7 * 86400000).toISOString();
  const today = localDate(nowISO);

  // Lazy abono maintenance first (expire lapsed signups, roll recurring members
  // into next month), so the lists below are current.
  await supabase.rpc("admin_membership_cycle");

  const [payRes, weekRes, upcomingRes, overdueRes, rollRes] = await Promise.all([
    // Payments needing a human (bounded; receipts fetched lazily on click):
    // manual receipts waiting for approval, PLUS any Talo payment the settle path
    // could not resolve on its own (underpaid, unverifiable, paid without a slot,
    // reversed…). Filtering on provider='manual' used to make those invisible.
    supabase
      .from("payments")
      .select(
        // `profiles!user_id` disambiguates bookings' two FKs to profiles.
        "id, amount_ars, receipt_path, provider, status, admin_flag, reversed_at, kind, services(name), profiles(full_name, whatsapp_phone), membership_periods!payments_membership_period_id_fkey(period, memberships(services(name))), bookings(starts_at, services(name), profiles!user_id(full_name, whatsapp_phone))",
        { count: "exact" },
      )
      .in("provider", ["manual", "talo"])
      .or("status.eq.pending,admin_flag.not.is.null,reversed_at.not.is.null")
      .order("created_at", { ascending: true })
      .limit(50),
    supabase
      .from("bookings")
      .select(BOOKINGS_SELECT, { count: "exact" })
      .in("status", ACTIVE)
      .gte("starts_at", nowISO)
      .lt("starts_at", weekISO)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(WEEK_LIMIT),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("status", ACTIVE)
      .gte("starts_at", nowISO),
    // Cuotas past their due day (the surcharge and "releasable" are derived).
    supabase
      .from("membership_periods_v")
      .select(
        "id, membership_id, period, amount_ars, amount_due_ars, is_late, days_late, releasable, late_fee_pct",
        { count: "exact" },
      )
      .eq("status", "pending")
      .in("membership_status", MEMBERSHIP_ACTIVE)
      .lt("due_on", today)
      .order("due_on", { ascending: true })
      .limit(50),
    // Recurring members whose bed was taken next month (their roll failed).
    supabase
      .from("memberships")
      .select("id, user_id, roll_error, services(name), profiles!memberships_user_id_fkey(full_name)")
      .eq("status", "active")
      .not("roll_error", "is", null)
      .limit(20),
  ]);
  if (payRes.error) loadErrors.push(`Pagos: ${payRes.error.message}`);
  if (weekRes.error) loadErrors.push(`Turnos: ${weekRes.error.message}`);
  if (upcomingRes.error) loadErrors.push(`Próximos: ${upcomingRes.error.message}`);
  if (overdueRes.error) loadErrors.push(`Cuotas: ${overdueRes.error.message}`);

  const overduePeriods = (overdueRes.data ?? []) as any[];
  const { data: overdueMembers } = overduePeriods.length
    ? await supabase
        .from("memberships")
        .select(
          "id, user_id, services(name), profiles!memberships_user_id_fkey(full_name, whatsapp_phone), membership_slots(weekday, start_time)",
        )
        .in("id", [...new Set(overduePeriods.map((p) => p.membership_id))])
    : { data: [] };
  const memberById = new Map(((overdueMembers ?? []) as any[]).map((m) => [m.id, m]));
  const overdue: OverdueRow[] = overduePeriods.map((p) => {
    const m = memberById.get(p.membership_id);
    return {
      periodId: p.id,
      membershipId: p.membership_id,
      userId: m?.user_id ?? "",
      client: m?.profiles?.full_name ?? "Cliente",
      phone: m?.profiles?.whatsapp_phone ?? null,
      plan: m?.services?.name ?? "Abono",
      period: p.period,
      amountDue: p.amount_due_ars,
      base: p.amount_ars,
      lateFeePct: p.late_fee_pct,
      daysLate: p.days_late,
      releasable: p.releasable,
      isLate: p.is_late,
      slots: m?.membership_slots ?? [],
    };
  });
  const overdueTotal = overdueRes.count ?? overdue.length;
  const rollErrors = (rollRes.data ?? []) as any[];

  const payments = ((payRes.data ?? []) as any[]).map((p) => ({
    id: p.id as string,
    amount: p.amount_ars as number,
    receiptPath: (p.receipt_path as string) ?? null,
    provider: (p.provider as "manual" | "talo") ?? "manual",
    status: (p.status as "pending" | "approved" | "rejected") ?? "pending",
    adminFlag: (p.admin_flag as string) ?? null,
    reversed: Boolean(p.reversed_at),
    service:
      p.bookings?.services?.name ??
      (p.kind === "pack"
        ? `Pack · ${p.services?.name ?? ""}`.trim()
        : p.kind === "membership"
          ? `Cuota ${String(p.membership_periods?.period ?? "").slice(0, 7)} · ${p.membership_periods?.memberships?.services?.name ?? "Abono"}`
          : "Servicio"),
    when: (p.bookings?.starts_at as string) ?? null,
    // Booking payments name the client through the booking; pack and cuota
    // payments carry user_id themselves.
    client: p.bookings?.profiles?.full_name ?? p.profiles?.full_name ?? "—",
    phone:
      (p.bookings?.profiles?.whatsapp_phone as string) ??
      (p.profiles?.whatsapp_phone as string) ??
      null,
  }));
  const paymentsTotal = payRes.count ?? payments.length;

  const week = ((weekRes.data ?? []) as any[]).map(mapBooking);
  const weekTotal = weekRes.count ?? week.length;
  const todayCount = week.filter((b) => localDate(b.startsAt) === today).length;

  return (
    <PageShell size="wide" nav={<AdminTabs />} eyebrow="Panel" title="Administración">
      <LoadErrors errors={loadErrors} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Hoy" value={todayCount} hint="turnos que quedan hoy" />
        <Stat label="7 días" value={weekTotal} hint="turnos activos" />
        <Stat label="Próximos" value={upcomingRes.count ?? 0} hint="en total" />
        <Stat label="Pagos" value={paymentsTotal} hint="por revisar" />
        <Stat label="Cuotas" value={overdueTotal} hint="vencidas" />
      </div>

      <div className="mt-8">
        <PushManager />
      </div>

      {(overdueTotal > 0 || rollErrors.length > 0) && (
        <section className="mt-10">
          <div className="flex items-baseline justify-between gap-4">
            <SectionTitle>Cuotas vencidas</SectionTitle>
            <Link
              href="/admin/abonos"
              className="text-sm text-accent underline-offset-4 hover:underline"
            >
              Ver abonos →
            </Link>
          </div>
          {rollErrors.length > 0 && (
            <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-fg-muted">
              <p className="font-medium text-fg">Abonos que no se pudieron renovar</p>
              <p className="mt-1">
                Otro turno ocupa una de sus camas el mes que viene. Reprogramá ese turno o
                cambiales la cama:{" "}
                {rollErrors.map((m, i) => (
                  <span key={m.id}>
                    {i > 0 && ", "}
                    <Link
                      href={`/admin/clientes/${m.user_id}`}
                      className="text-accent underline-offset-4 hover:underline"
                    >
                      {m.profiles?.full_name ?? "Cliente"}
                    </Link>
                  </span>
                ))}
                .
              </p>
            </div>
          )}
          <OverduePeriods rows={overdue} />
          {overdueTotal > overdue.length && (
            <p className="mt-3 text-sm text-fg-faint">
              Mostrando {overdue.length} de {overdueTotal}.
            </p>
          )}
        </section>
      )}

      <section className="mt-10">
        <SectionTitle>Pagos por revisar</SectionTitle>
        <AdminPayments payments={payments} total={paymentsTotal} />
      </section>

      <section className="mt-12">
        <div className="flex items-baseline justify-between gap-4">
          <SectionTitle>Próximos 7 días</SectionTitle>
          <Link
            href="/admin/turnos"
            className="text-sm text-accent underline-offset-4 hover:underline"
          >
            Ver todos los turnos →
          </Link>
        </div>
        <BookingList
          rows={week}
          nowISO={nowISO}
          empty="No hay turnos en los próximos 7 días."
        />
        {weekTotal > week.length && (
          <p className="mt-4 text-sm text-fg-faint">
            Mostrando {week.length} de {weekTotal}.{" "}
            <Link href="/admin/turnos" className="text-accent hover:underline">
              Ver el resto
            </Link>
          </p>
        )}
      </section>
    </PageShell>
  );
}
