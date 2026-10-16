import { Lock } from "lucide-react";
import { byWeekOrder, hm, WEEKDAY_SHORT } from "@/lib/membership";
import { cn } from "@/lib/utils";

// An abono's weekly schedule as chips: "Mar · 18:00 · Cama 2". A locked
// (recurring) schedule ends with a "Horario fijo" chip: icon AND text.
export function MembershipScheduleChips({
  slots,
  locked,
  size = "default",
  className,
}: {
  slots: { weekday: number; start_time: string; resource_name?: string | null }[];
  locked?: boolean;
  size?: "sm" | "default";
  className?: string;
}) {
  const chip = cn(
    "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 text-fg",
    size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
  );
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Horario semanal">
      {byWeekOrder(slots).map((s) => (
        <li key={s.weekday} className={chip}>
          <span className="font-medium">{WEEKDAY_SHORT[s.weekday]}</span>
          <span className="font-mono tabular-nums text-fg-muted">{hm(s.start_time)}</span>
          {s.resource_name && <span className="text-fg-faint">{s.resource_name}</span>}
        </li>
      ))}
      {locked && (
        <li className={cn(chip, "border-accent/30 bg-accent/10 text-accent")}>
          <Lock className="size-3" aria-hidden />
          Horario fijo
        </li>
      )}
    </ul>
  );
}
