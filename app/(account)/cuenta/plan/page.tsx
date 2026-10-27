import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PlanView, type PlanData } from "@/components/account/plan-view";
import { PageShell } from "@/components/ui/page-shell";
import type { MembershipPeriod, SwapRequestRow } from "@/lib/membership";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The client's abono: schedule, renewal, cuotas, swap offers, history.
export default async function PlanPage() {
  const user = await requireSession("/cuenta/plan");
  const supabase = await createClient();

  // Own rows through RLS; the user filter is explicit because an admin's RLS
  // returns everyone's.
  const [{ data: memberships }, { data: swaps }] = await Promise.all([
    supabase
      .from("memberships")
      .select(
        "id, status, locked, starts_on, ends_on, hold_expires_at, service_id, created_at, services(name, price_ars, classes_per_week), sectors(name, timezone, due_day, late_fee_pct, release_day, change_notice_hours), membership_slots(weekday, start_time, resources(name))",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase.rpc("my_swap_requests"),
  ]);

  const all = (memberships ?? []) as any[];
  const current = all.find((m) => m.status === "pending" || m.status === "active") ?? null;
  const past = all.filter((m) => m !== current && (m.status === "cancelled" || m.status === "expired"));

  const { data: periods } = current
    ? await supabase
        .from("membership_periods_v")
        .select("*")
        .eq("membership_id", current.id)
        .order("period", { ascending: false })
    : { data: [] };

  const data: PlanData = {
    current: current && {
      id: current.id,
      status: current.status,
      locked: current.locked,
      startsOn: current.starts_on,
      endsOn: current.ends_on,
      serviceId: current.service_id,
      plan: current.services?.name ?? "Abono",
      price: current.services?.price_ars ?? 0,
      classesPerWeek: current.services?.classes_per_week ?? 0,
      sector: current.sectors,
      slots: (current.membership_slots ?? []).map((s: any) => ({
        weekday: s.weekday,
        start_time: s.start_time,
        resource_name: s.resources?.name ?? null,
      })),
    },
    periods: (periods ?? []) as MembershipPeriod[],
    past: past.map((m) => ({
      id: m.id,
      plan: m.services?.name ?? "Abono",
      status: m.status,
      startsOn: m.starts_on,
      endsOn: m.ends_on,
    })),
    swaps: ((swaps ?? []) as SwapRequestRow[]),
  };

  return (
    <PageShell size="wide" top="tight" eyebrow="Tu cuenta" title="Abono">
      <PlanView data={data} />
    </PageShell>
  );
}
