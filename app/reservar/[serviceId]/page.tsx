import { notFound } from "next/navigation";
import { getService } from "@/lib/services";
import { getUserAndProfile } from "@/lib/auth";
import { formatARS } from "@/lib/site";
import { PageShell } from "@/components/ui/page-shell";
import { BookingFlow } from "./booking-flow";
import { NameGate } from "./name-gate";

export default async function ReservarPage({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  const { serviceId } = await params;
  const service = await getService(serviceId);
  if (!service || !service.active) notFound();

  const { user, profile } = await getUserAndProfile();
  const needsName = Boolean(user) && !profile?.full_name?.trim();

  return (
    <PageShell
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
      {needsName ? (
        <NameGate />
      ) : (
        <BookingFlow service={service} isAuthed={Boolean(user)} />
      )}
    </PageShell>
  );
}
