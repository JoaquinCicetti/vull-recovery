import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageShell size="wide" top="tight" eyebrow="Tu cuenta" title="Avisos">
      <div aria-hidden="true">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-4 h-32 w-full rounded-lg" />
        <Skeleton className="mt-12 h-3 w-28" />
        <Skeleton className="mt-4 h-24 w-full rounded-lg" />
      </div>
    </PageShell>
  );
}
