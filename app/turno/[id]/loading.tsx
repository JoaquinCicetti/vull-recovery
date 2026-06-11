import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageShell eyebrow="Tu turno" title={<Skeleton className="h-9 w-56" />}>
      <div className="surface-card surface-lift p-6" aria-hidden="true">
        <div className="flex items-start justify-between gap-4">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-6 w-20 rounded-md" />
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-5 w-24" />
        </div>
      </div>
      <Skeleton className="mt-6 h-12 w-full rounded-md" aria-hidden="true" />
    </PageShell>
  );
}
