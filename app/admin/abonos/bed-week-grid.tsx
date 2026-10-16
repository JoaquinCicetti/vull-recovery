import Link from "next/link";
import { Lock } from "lucide-react";
import { fmtTime, localDate } from "@/lib/format";
import { WEEK_ORDER, WEEKDAY_SHORT } from "@/lib/membership";
import { cn } from "@/lib/utils";

export type GridBooking = {
  id: string;
  startsAt: string;
  resourceId: string;
  status: string;
  client: string;
  membership: { locked: boolean } | null;
};

// Who holds each bed this week: beds down, weekdays across. Abono classes carry
// a lock when the schedule is fixed; unpaid ones read "sin pagar".
export function BedWeekGrid({
  beds,
  days,
  bookings,
  today,
  tz,
}: {
  beds: { id: string; name: string }[];
  /** The 7 local dates of the week, Monday first. */
  days: string[];
  bookings: GridBooking[];
  today: string;
  tz: string;
}) {
  const cell = (bedId: string, date: string) =>
    bookings
      .filter((b) => b.resourceId === bedId && localDate(b.startsAt, tz) === date)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return (
    <div className="surface-card overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-xs">
        <thead>
          <tr>
            <th className="w-20 border-b border-border px-3 py-2 text-left font-mono font-normal uppercase tracking-wider text-fg-faint">
              Cama
            </th>
            {days.map((d, i) => (
              <th
                key={d}
                className={cn(
                  "border-b border-border px-2 py-2 text-left font-medium",
                  d === today ? "text-accent" : "text-fg-muted",
                )}
              >
                {WEEKDAY_SHORT[WEEK_ORDER[i]]} {Number(d.slice(8))}
                {d === today && <span className="ml-1 font-normal">· hoy</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {beds.map((bed) => (
            <tr key={bed.id} className="align-top">
              <th className="border-b border-border px-3 py-2 text-left font-medium text-fg">
                {bed.name}
              </th>
              {days.map((d) => {
                const items = cell(bed.id, d);
                return (
                  <td key={d} className="border-b border-l border-border px-2 py-1.5">
                    {items.length === 0 ? (
                      <span className="text-fg-faint">—</span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {items.map((b) => (
                          <li key={b.id}>
                            <Link
                              href={`/turno/${b.id}`}
                              className={cn(
                                "flex items-center gap-1 underline-offset-2 hover:underline",
                                b.status === "confirmed" ? "text-fg" : "text-amber-300",
                              )}
                            >
                              <span className="font-mono tabular-nums text-fg-muted">
                                {fmtTime(b.startsAt, tz)}
                              </span>
                              <span className="truncate">{b.client}</span>
                              {b.membership?.locked && (
                                <>
                                  <Lock className="size-3 shrink-0 text-accent" aria-hidden />
                                  <span className="sr-only">horario fijo</span>
                                </>
                              )}
                              {b.status !== "confirmed" && (
                                <span className="shrink-0 text-[10px]">sin pagar</span>
                              )}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
