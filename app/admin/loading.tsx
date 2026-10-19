import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageShell size="wide" top="tight">
      <div aria-hidden="true">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-6 h-10 w-full max-w-sm rounded-md" />
        <Skeleton className="mt-8 h-3 w-56" />
        <div className="mt-3 flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </PageShell>
  );
}
