import { notFound, redirect } from "next/navigation";
import { getService } from "@/lib/services";
import { getUserAndProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isMonthly, type Sector } from "@/lib/types";
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
  const service = await getService(serviceId);
  if (!service || !service.active || !isMonthly(service)) notFound();

  const supabase = await createClient();
  const [{ user, profile }, { data: sector }] = await Promise.all([
    getUserAndProfile(),
    supabase
      .from("sectors")
      .select("id, name, timezone, due_day, late_fee_pct, release_day, hold_minutes")
      .eq("id", service.sector_id)
      .single<Pick<Sector, "id" | "name" | "timezone" | "due_day" | "late_fee_pct" | "release_day" | "hold_minutes">>(),
  ]);
  if (!sector) notFound();

  // One abono per sector: someone who already has one goes to it.
  if (user) {
    const { data: current } = await supabase
      .from("memberships")
      .select("id, status, membership_periods(id, status)")
      .eq("user_id", user.id)
      .eq("sector_id", service.sector_id)
      .in("status", ["pending", "active"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
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
