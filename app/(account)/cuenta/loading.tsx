import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

// Wraps EVERY /cuenta/* page while it loads (a segment's loading.tsx covers
// its children), so it names no page: a titled skeleton here read as "Perfil"
// on the way to Plan or Sesiones.
export default function Loading() {
  return (
    <PageShell top="tight" eyebrow="Tu cuenta" title={<Skeleton className="h-9 w-40" />}>
      <div aria-hidden="true">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="mt-12 h-3 w-24" />
        <Skeleton className="mt-4 h-56 w-full rounded-lg" />
      </div>
    </PageShell>
  );
}
