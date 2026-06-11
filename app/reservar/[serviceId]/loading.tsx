import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageShell ambient eyebrow="Reservar" title={<Skeleton className="h-9 w-52" />}>
      <div className="mt-2 flex flex-col gap-4" aria-hidden="true">
        <Skeleton className="h-[72px] w-full rounded-lg" />
        <Skeleton className="h-4 w-40" />
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-md" />
          ))}
        </div>
        <Skeleton className="mt-4 h-12 w-full rounded-md" />
      </div>
    </PageShell>
  );
}
