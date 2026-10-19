import { createClient } from "@/lib/supabase/server";
import { AdminPayments } from "../admin-payments";
import { SectionTitle } from "@/components/admin/stat";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Talo payments the settle path could not resolve on its own (underpaid,
// unverifiable, paid without a slot, reversed…), plus any legacy receipt still
// waiting. Rendered on the agenda only when there is something to look at:
// with Talo settling everything, this is usually nothing.
export async function FlaggedPayments() {
  const supabase = await createClient();
  const { data, count, error } = await supabase
    .from("payments")
    .select(
      // `profiles!user_id` disambiguates bookings' two FKs to profiles.
      "id, amount_ars, receipt_path, provider, status, admin_flag, reversed_at, kind, services(name), profiles(full_name, whatsapp_phone), membership_periods!payments_membership_period_id_fkey(period, memberships(services(name))), bookings(starts_at, services(name), profiles!user_id(full_name, whatsapp_phone))",
      { count: "exact" },
    )
    .in("provider", ["manual", "talo"])
    .or("admin_flag.not.is.null,reversed_at.not.is.null,and(provider.eq.manual,status.eq.pending)")
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) {
    return (
      <p className="mb-6 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
        Pagos: {error.message}
      </p>
    );
  }
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return null;

  const payments = rows.map((p) => ({
    id: p.id as string,
    amount: p.amount_ars as number,
    receiptPath: (p.receipt_path as string) ?? null,
    provider: (p.provider as "manual" | "talo") ?? "talo",
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
    client: p.bookings?.profiles?.full_name ?? p.profiles?.full_name ?? "—",
    phone:
      (p.bookings?.profiles?.whatsapp_phone as string) ??
      (p.profiles?.whatsapp_phone as string) ??
      null,
  }));

  return (
    <section className="mb-8 rounded-lg border border-amber-400/25 bg-amber-400/5 p-4">
      <SectionTitle>Pagos que necesitan una mirada</SectionTitle>
      <AdminPayments payments={payments} total={count ?? payments.length} />
    </section>
  );
}
