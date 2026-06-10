import { notFound } from "next/navigation";
import { getService } from "@/lib/services";
import { getUserAndProfile } from "@/lib/auth";
import { formatARS } from "@/lib/site";
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
    <div className="mx-auto max-w-2xl px-5 py-16">
      <p className="eyebrow">Reservar</p>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">{service.name}</h1>
      <p className="mt-2">
        <span className="font-mono text-lg font-semibold text-accent">
          {formatARS(service.price_ars)}
        </span>
        <span className="text-fg-faint"> · {service.duration_minutes} min</span>
      </p>
      {service.description && (
        <p className="mt-3 text-sm leading-relaxed text-fg-muted">
          {service.description}
        </p>
      )}

      {needsName ? (
        <NameGate />
      ) : (
        <BookingFlow service={service} isAuthed={Boolean(user)} />
      )}
    </div>
  );
}
