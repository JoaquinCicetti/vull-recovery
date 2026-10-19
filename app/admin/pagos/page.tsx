import Link from "next/link";
import { MEMBERSHIP_ACTIVE } from "@/lib/booking-status";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/format";
import { AdminPayments } from "../admin-payments";
import { OverduePeriods, type OverdueRow } from "@/components/admin/overdue-periods";
import { LoadErrors } from "@/components/admin/load-errors";
import { SectionTitle } from "@/components/admin/stat";
import { PageShell } from "@/components/ui/page-shell";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Money that needs a human: receipts and flagged transfers to review (turnos
// and packs), and cuotas past their due day (abonos). Two lists, two kinds
// of money, never mixed into one.
export default async function PagosPage() {
  await requireAdmin();
  const supabase = await createClient();
  const loadErrors: string[] = [];

  // eslint-disable-next-line react-hooks/purity -- server component: renders once
  const today = localDate(new Date(Date.now()).toISOString());

  await supabase.rpc("admin_membership_cycle");

  const [payRes, overdueRes, rollRes] = await Promise.all([
    // Payments needing a human (bounded; receipts fetched lazily on click):
    // manual receipts waiting for approval, PLUS any Talo payment the settle path
    // could not resolve on its own (underpaid, unverifiable, paid without a slot,
    // reversed…).
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

  return (
    <PageShell size="wide" top="tight" eyebrow="Panel" title="Pagos">
      <LoadErrors errors={loadErrors} />

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <SectionTitle>Por revisar</SectionTitle>
          <span className="font-mono text-xs tabular-nums text-fg-faint">{paymentsTotal}</span>
        </div>
        <AdminPayments payments={payments} total={paymentsTotal} />
      </section>

      <section className="mt-12">
        <div className="flex items-baseline justify-between gap-4">
          <SectionTitle>Cuotas vencidas</SectionTitle>
          <span className="font-mono text-xs tabular-nums text-fg-faint">{overdueTotal}</span>
        </div>
        {rollErrors.length > 0 && (
          <div className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-fg-muted">
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
        <div className="mt-3">
          <OverduePeriods rows={overdue} />
        </div>
        {overdueTotal > overdue.length && (
          <p className="mt-3 text-sm text-fg-faint">
            Mostrando {overdue.length} de {overdueTotal}.
          </p>
        )}
      </section>
    </PageShell>
  );
}
