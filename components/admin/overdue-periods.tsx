"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readError } from "@/lib/read-error";
import { clientWaLink, formatARS } from "@/lib/site";
import { byWeekOrder, hm, capFirst,
  monthLabel, WEEKDAY_SHORT } from "@/lib/membership";
import { Button } from "@/components/ui/button";

export type OverdueRow = {
  periodId: string;
  membershipId: string;
  userId: string;
  client: string;
  phone: string | null;
  plan: string;
  period: string;
  amountDue: number;
  base: number;
  lateFeePct: number;
  daysLate: number;
  releasable: boolean;
  isLate: boolean;
  slots: { weekday: number; start_time: string }[];
};

// Cuotas past their due day, oldest first. "Cobré en efectivo" records the cash
// (surcharge included); from the release day, "Liberar lugar" frees the slots
// (paid months stay). No reminders are sent: this list is the nudge.
export function OverduePeriods({ rows }: { rows: OverdueRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-fg-faint">Todas las cuotas están al día.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <OverdueItem key={r.periodId} row={r} />
      ))}
    </ul>
  );
}

function OverdueItem({ row: r }: { row: OverdueRow }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.functions.invoke("admin-membership", { body });
    setBusy(false);
    if (err) {
      setError(await readError(err, "No se pudo completar."));
      setConfirmRelease(false);
      return;
    }
    router.refresh();
  }

  const first = r.client.split(" ")[0] || "";
  const wa = clientWaLink(
    r.phone,
    `Hola ${first}! Te escribimos de VULL: la cuota de ${monthLabel(r.period, false)} de tu abono (${formatARS(r.amountDue)}) está pendiente. La podés pagar desde la app, en Mi plan.`,
  );
  const schedule = byWeekOrder(r.slots)
    .map((s) => `${WEEKDAY_SHORT[s.weekday]} ${hm(s.start_time)}`)
    .join(" · ");
  return (
    <li className="surface-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/admin/clientes/${r.userId}`}
            className="font-semibold text-fg underline-offset-4 hover:underline"
          >
            {r.client}
          </Link>
          <p className="mt-0.5 text-sm text-fg-muted">
            {r.plan} · {capFirst(monthLabel(r.period, false))}
          </p>
          <p className="mt-0.5 font-mono text-xs text-fg-faint">{schedule}</p>
        </div>
        <div className="text-right">
          <p className="font-mono font-semibold tabular-nums text-fg">{formatARS(r.amountDue)}</p>
          {r.isLate && r.amountDue > r.base && (
            <p className="text-xs text-fg-faint">incluye +{r.lateFeePct} % de recargo</p>
          )}
          <span
            className={
              r.releasable
                ? "mt-1 inline-block rounded-md bg-danger/10 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-danger"
                : "mt-1 inline-block rounded-md bg-amber-400/15 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-amber-300"
            }
          >
            {r.daysLate} {r.daysLate === 1 ? "día" : "días"} de atraso
            {r.releasable && " · se puede liberar"}
          </span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => act({ action: "mark_paid", period_id: r.periodId })}>
          Cobré en efectivo
        </Button>
        {wa && (
          <Button asChild size="sm" variant="outline">
            <a href={wa} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
          </Button>
        )}
        {r.releasable &&
          (confirmRelease ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-fg">
                Se cancelan sus clases desde el mes impago y el horario queda libre. ¿Liberar?
              </span>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => act({ action: "release", membership_id: r.membershipId, reason: "Cuota impaga" })}
              >
                {busy ? "Liberando…" : "Sí, liberar"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRelease(false)}>
                No
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => setConfirmRelease(true)}>
              Liberar lugar
            </Button>
          ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
