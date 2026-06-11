import { notFound } from "next/navigation";
import { getService } from "@/lib/services";
import { getUserAndProfile } from "@/lib/auth";
import { formatARS } from "@/lib/site";
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
      />
    </PageShell>
  );
}
