import { formatARS } from "@/lib/site";
import { monthLabel, type MembershipPeriod } from "@/lib/membership";
import { cn } from "@/lib/utils";

// One cuota: its base amount, and when it is late the surcharge as its own
// labelled line (never color alone) and the total to pay.
export function PeriodAmount({
  period,
  lateFeePct,
  dueDay,
  size = "default",
}: {
  period: Pick<MembershipPeriod, "period" | "amount_ars" | "amount_due_ars" | "is_late">;
  lateFeePct: number;
  dueDay: number;
  size?: "default" | "lg";
}) {
  const surcharge = period.amount_due_ars - period.amount_ars;
  return (
    <dl className={cn("flex flex-col gap-1.5", size === "lg" ? "text-base" : "text-sm")}>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-fg-muted">Cuota de {monthLabel(period.period, false)}</dt>
        <dd className="font-mono tabular-nums text-fg">{formatARS(period.amount_ars)}</dd>
      </div>
      {period.is_late && surcharge > 0 && (
        <>
          <div className="flex items-baseline justify-between gap-4 text-amber-300">
            <dt>
              Recargo por pagar después del {dueDay} (+{lateFeePct} %)
            </dt>
            <dd className="font-mono tabular-nums">+{formatARS(surcharge)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-1.5">
            <dt className="font-medium text-fg">Total</dt>
            <dd className="font-mono font-semibold tabular-nums text-fg">
              {formatARS(period.amount_due_ars)}
            </dd>
          </div>
        </>
      )}
    </dl>
  );
}
