import { notFound } from "next/navigation";
import { getService } from "@/lib/services";
import { getUserAndProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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
  if (user) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("bookings")
      .select("starts_at")
      .eq("user_id", user.id)
      .in("status", ["pending", "awaiting_payment", "confirmed"])
      .gte("starts_at", new Date().toISOString());
    bookedDays = (data ?? []).map((b) => localDate(b.starts_at));
  }

  return (
    <PageShell
      ambient
      eyebrow="Reservar"
      title={service.name}
      description={
        <span>
          <span className="font-mono text-lg font-semibold text-accent">
            {formatARS(service.price_ars)}
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
      />
    </PageShell>
  );
}
