import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageShell eyebrow="Abono mensual" title={<Skeleton className="h-9 w-56" />}>
      <div className="mt-10 flex flex-col gap-4" aria-hidden="true">
        <Skeleton className="h-24 w-full rounded-lg" />
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-md" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[42px] rounded-md" />
          ))}
        </div>
      </div>
    </PageShell>
  );
}
