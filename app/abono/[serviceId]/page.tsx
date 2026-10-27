import { notFound, redirect } from "next/navigation";
import { MEMBERSHIP_ACTIVE } from "@/lib/booking-status";
import { getSessionUser, getUserAndProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isMonthly, type Sector, type Service } from "@/lib/types";
import { formatARS } from "@/lib/site";
import { localDate } from "@/lib/format";
import { PageShell } from "@/components/ui/page-shell";
import { MembershipSignup } from "./membership-signup";

// Sign up for a monthly plan (abono): start date, renew every month or not,
// then the weekly schedule. Creating it holds the schedule and goes to the
// payment of the first (prorated) cuota.
export default async function AbonoPage({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  const { serviceId } = await params;
  const session = await getSessionUser();
  const supabase = await createClient();
  // One round trip: the plan with its sector, the profile, and the user's live
  // abonos (filtered to this sector below, once the plan is known).
  const [{ data: svc }, { user, profile }, { data: mine }] = await Promise.all([
    supabase
      .from("services")
      .select("*, sectors(id, name, timezone, due_day, late_fee_pct, release_day, hold_minutes)")
      .eq("id", serviceId)
      .maybeSingle<
        Service & {
          sectors: Pick<
            Sector,
            "id" | "name" | "timezone" | "due_day" | "late_fee_pct" | "release_day" | "hold_minutes"
          > | null;
        }
      >(),
    getUserAndProfile(),
    session
      ? supabase
          .from("memberships")
          .select("id, status, sector_id, membership_periods(id, status)")
          .eq("user_id", session.id)
          .in("status", MEMBERSHIP_ACTIVE)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
  ]);
  if (!svc || !svc.active || !isMonthly(svc)) notFound();
  const { sectors: sector, ...service } = svc;
  if (!sector) notFound();

  // One abono per sector: someone who already has one goes to it.
  if (user) {
    const current = ((mine ?? []) as { id: string; status: string; sector_id: string; membership_periods: { id: string; status: string }[] | null }[]).find(
      (m) => m.sector_id === service.sector_id,
    );
    if (current) {
      const unpaid = (current.membership_periods as { id: string; status: string }[] | null)?.find(
        (p) => p.status === "pending",
      );
      if (current.status === "pending" && unpaid) redirect(`/cuenta/plan/pagar/${unpaid.id}`);
      redirect("/cuenta/plan");
    }
  }

  const today = localDate(new Date().toISOString(), sector.timezone);
  const n = service.classes_per_week ?? 1;
  return (
    <PageShell
      ambient
      eyebrow={`Abono mensual · ${sector.name}`}
      title={service.name}
      description={
        <span>
          <span className="font-mono text-lg font-semibold text-accent">
            {formatARS(service.price_ars)}
          </span>
          <span className="text-fg-faint">
            {" "}
            / mes · {n} {n === 1 ? "clase" : "clases"} por semana · {service.duration_minutes} min
          </span>
          {service.description && (
            <span className="mt-3 block text-sm leading-relaxed text-fg-muted">
              {service.description}
            </span>
          )}
        </span>
      }
    >
      <MembershipSignup
        service={service}
        sector={sector}
        today={today}
        isAuthed={Boolean(user)}
        profile={profile}
      />
    </PageShell>
  );
}
