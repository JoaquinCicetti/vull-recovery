import { cn } from "@/lib/utils";
import type { Service } from "@/lib/types";

/**
 * What a plan includes, as tags (set per plan in Ajustes; hidden with
 * show_stations). Spans only: it renders inside PageShell's description too.
 */
export function PlanStations({
  service,
  className,
}: {
  service: Pick<Service, "stations" | "show_stations">;
  className?: string;
}) {
  const list = service.show_stations ? (service.stations ?? []) : [];
  if (list.length === 0) return null;
  return (
    <span role="list" aria-label="Incluye" className={cn("flex flex-wrap gap-1.5", className)}>
      {list.map((s) => (
        <span
          key={s}
          role="listitem"
          className="inline-flex items-center rounded-md border border-border bg-surface-2/80 px-2 py-0.5 text-xs font-medium text-fg-muted"
        >
          {s}
        </span>
      ))}
    </span>
  );
}
