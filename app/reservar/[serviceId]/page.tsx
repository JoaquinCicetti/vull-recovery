import { notFound, redirect } from "next/navigation";
import { getService } from "@/lib/services";
import { getSessionUser, getUserAndProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyBalances } from "@/lib/credits";
import { isMonthly, isPack } from "@/lib/types";
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
  // The session is verified locally, so everything the page needs — the plan,
  // the profile, the user's active turnos, their credits — is ONE round trip.
  // (Four in a row before: this page gates the booking flow, so it shows.)
  const session = await getSessionUser();
  const supabase = await createClient();
  const [service, { user, profile }, bookingsRes, balances] = await Promise.all([
    getService(serviceId),
    getUserAndProfile(),
    session
      ? supabase
          .from("bookings")
          .select("starts_at, sector_id")
          .eq("user_id", session.id)
          .in("status", ["pending", "awaiting_payment", "confirmed"])
          .gte("starts_at", new Date().toISOString())
      : Promise.resolve({ data: [] as { starts_at: string; sector_id: string }[] }),
    session ? getMyBalances() : Promise.resolve({} as Record<string, number>),
  ]);
  if (!service || !service.active) notFound();
  // A monthly plan is a weekly schedule, not a single turno.
  if (isMonthly(service)) redirect(`/abono/${service.id}`);

  // Days the user already has an active turno on IN THIS SECTOR — one turno per
  // day per sector is enforced server-side; surfacing it here disables those days
  // before the round-trip.
  const bookedDays = user
    ? (bookingsRes.data ?? [])
        .filter((b) => b.sector_id === service.sector_id)
        .map((b) => localDate(b.starts_at))
    : [];
  const credits = user ? (balances[service.id] ?? 0) : 0;

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
