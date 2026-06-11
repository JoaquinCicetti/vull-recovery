import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageShell size="narrow" eyebrow="Tu cuenta" title="Mi cuenta">
      <div className="surface-card surface-lift p-6" aria-hidden="true">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="mt-2 h-10 w-32 rounded-md" />
        </div>
      </div>
    </PageShell>
  );
}
