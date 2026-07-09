import { notFound, redirect } from "next/navigation";
import { getService } from "@/lib/services";
import { getUserAndProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyBalances } from "@/lib/credits";
import { isPack } from "@/lib/types";
import { formatARS } from "@/lib/site";
import { localDate } from "@/lib/format";
import { PageShell } from "@/components/ui/page-shell";
import { BookingFlow } from "./booking-flow";

export default async function ReservarPage({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  const { serviceId } = await params;
  const service = await getService(serviceId);
  if (!service || !service.active) notFound();

  const { user, profile } = await getUserAndProfile();

  // Days the user already has an active turno on — one turno per day is enforced
  // server-side; surfacing it here disables those days before the round-trip.
  let bookedDays: string[] = [];
  let credits = 0;
  if (user) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("bookings")
      .select("starts_at")
      .eq("user_id", user.id)
      .in("status", ["pending", "awaiting_payment", "confirmed"])
      .gte("starts_at", new Date().toISOString());
    bookedDays = (data ?? []).map((b) => localDate(b.starts_at));
    const balances = await getMyBalances();
    credits = balances[service.id] ?? 0;
  }

  // A pack's price_ars buys the WHOLE pack. Booking it without a credit would take
  // the ordinary paid path and charge that full price for a single session, so send
  // anyone holding no credit to the purchase page instead. Past this line the
  // invariant holds: if you can see a pack's booking flow, you have a credit to spend.
  if (isPack(service) && credits === 0) redirect(`/comprar/${service.id}`);

  return (
    <PageShell
      ambient
      eyebrow="Reservar"
      title={service.name}
      description={
        <span>
          <span className="font-mono text-lg font-semibold text-accent">
            {credits > 0 ? "1 crédito" : formatARS(service.price_ars)}
          </span>
          <span className="text-fg-faint"> · {service.duration_minutes} min</span>
          {service.description && (
            <span className="mt-3 block text-sm leading-relaxed text-fg-muted">
              {service.description}
            </span>
          )}
        </span>
      }
    >
      <BookingFlow
        service={service}
        isAuthed={Boolean(user)}
        profile={profile}
        bookedDays={bookedDays}
        credits={credits}
      />
    </PageShell>
  );
}
