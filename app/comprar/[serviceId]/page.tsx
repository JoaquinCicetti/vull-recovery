import { notFound } from "next/navigation";
import { getService } from "@/lib/services";
import { getUserAndProfile } from "@/lib/auth";
import { formatARS } from "@/lib/site";
import { PageShell } from "@/components/ui/page-shell";
import { PurchasePanel } from "./purchase-panel";

export default async function ComprarPage({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  const { serviceId } = await params;
  const pack = await getService(serviceId);
  // Only packs are purchasable here (bookable services are booked, not bought).
  if (!pack || !pack.active || !pack.grants_service_id) notFound();

  const { user } = await getUserAndProfile();

  return (
    <PageShell
      ambient
      eyebrow="Comprar pack"
      title={pack.name}
      description={
        <span>
          <span className="font-mono text-lg font-semibold text-accent">
            {formatARS(pack.price_ars)}
          </span>
          <span className="text-fg-faint">
            {" "}
            · {pack.sessions_included} sesiones
            {pack.validity_days ? ` · vencen en ${pack.validity_days} días` : ""}
          </span>
          {pack.description && (
            <span className="mt-3 block text-sm leading-relaxed text-fg-muted">
              {pack.description}
            </span>
          )}
        </span>
      }
    >
      <PurchasePanel
        packId={pack.id}
        amount={pack.price_ars}
        isAuthed={Boolean(user)}
      />
    </PageShell>
  );
}
