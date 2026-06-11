import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageShell eyebrow="Tus reservas" title="Mis turnos">
      <ul className="flex flex-col gap-3" aria-hidden="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="surface-card surface-lift p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-6 w-20 rounded-md" />
            </div>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
