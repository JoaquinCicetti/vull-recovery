import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageShell top="tight" eyebrow="Tu abono" title={<Skeleton className="h-9 w-48" />}>
      <div className="flex flex-col gap-6" aria-hidden="true">
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    </PageShell>
  );
}
