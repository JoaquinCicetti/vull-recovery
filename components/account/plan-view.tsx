import Link from "next/link";
import { formatARS } from "@/lib/site";
import {
  dateLabel,
  MEMBERSHIP_STATUS_LABEL,
  MEMBERSHIP_STATUS_STYLE,
  capFirst,
  monthLabel,
  periodStatusLabel,
  type MembershipPeriod,
  type MembershipStatus,
  type SwapRequestRow,
} from "@/lib/membership";
import { cn } from "@/lib/utils";
import { Section } from "@/components/account/section";
import { Button } from "@/components/ui/button";
import { MembershipScheduleChips } from "@/components/membership/schedule-chips";
import { PeriodAmount } from "@/components/membership/period-amount";
import { LockSwitch } from "@/components/membership/lock-switch";
import { SwapInbox } from "@/components/membership/swap-inbox";
import { StopMembership } from "@/components/membership/stop-membership";

export type PlanData = {
  current: {
    id: string;
    status: MembershipStatus;
    locked: boolean;
    startsOn: string;
    endsOn: string | null;
    serviceId: string;
    plan: string;
    price: number;
    classesPerWeek: number;
    sector: {
      name: string;
      timezone: string;
      due_day: number;
      late_fee_pct: number;
      release_day: number;
      change_notice_hours: number;
    } | null;
    slots: { weekday: number; start_time: string; resource_name: string | null }[];
  } | null;
  periods: MembershipPeriod[];
  past: { id: string; plan: string; status: MembershipStatus; startsOn: string; endsOn: string | null }[];
  swaps: SwapRequestRow[];
};

export function PlanView({ data }: { data: PlanData }) {
  const m = data.current;

  if (!m) {
    return (
      <>
        <div className="surface-card animate-fade-up border-dashed p-8 text-center">
          <p className="font-medium text-fg">No tenés un abono activo</p>
          <p className="mt-1.5 text-sm text-fg-muted">
            Elegí días y horario fijos y pagá por mes.
          </p>
          <Button asChild className="mt-5">
            <Link href="/planes#planes">Ver planes</Link>
          </Button>
        </div>
        {data.swaps.length > 0 && (
          <Section title="Intercambios" className="scroll-mt-24" >
            <div id="intercambios">
              <SwapInbox swaps={data.swaps} timezone="America/Argentina/Buenos_Aires" />
            </div>
          </Section>
        )}
        <PastList past={data.past} />
      </>
    );
  }

  const sector = m.sector;
  const due = [...data.periods]
    .filter((p) => p.status === "pending")
    .sort((a, b) => a.period.localeCompare(b.period))[0];
  const history = data.periods.filter((p) => p.status !== "pending");

  return (
    <>
      <div className="surface-card surface-lift animate-fade-up p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold text-fg">{m.plan}</p>
            <p className="mt-0.5 text-sm text-fg-muted">
              {m.classesPerWeek} {m.classesPerWeek === 1 ? "clase" : "clases"} por semana ·{" "}
              <span className="font-mono">{formatARS(m.price)}</span> / mes
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-md px-2 py-0.5 text-xs font-medium",
              MEMBERSHIP_STATUS_STYLE[m.status],
            )}
          >
            {MEMBERSHIP_STATUS_LABEL[m.status]}
          </span>
        </div>
        <MembershipScheduleChips className="mt-4" slots={m.slots} locked={m.locked} />
        <p className="mt-3 text-xs text-fg-faint">
          Desde el {dateLabel(m.startsOn)}
          {m.endsOn && ` · termina el ${dateLabel(m.endsOn)}`}. Tus clases están en{" "}
          <Link href="/mis-turnos" className="text-accent underline-offset-4 hover:underline">
            Mis turnos
          </Link>
          : desde cada una podés moverla o intercambiarla hasta{" "}
          {sector?.change_notice_hours ?? 24} h antes.
        </p>
      </div>

      {sector && (
        <div className="surface-card mt-4">
          <LockSwitch
            membershipId={m.id}
            locked={m.locked}
            dueDay={sector.due_day}
            lateFeePct={sector.late_fee_pct}
            releaseDay={sector.release_day}
            endsOn={m.endsOn}
          />
        </div>
      )}

      <Section title="Cuota">
        {due && sector ? (
          <div className="surface-card p-5">
            <PeriodAmount period={due} lateFeePct={sector.late_fee_pct} dueDay={sector.due_day} />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className={cn("text-sm", due.is_late ? "text-amber-300" : "text-fg-muted")}>
                {due.is_late
                  ? `Venció el ${dateLabel(due.due_on)}`
                  : m.status === "pending"
                    ? "Pagala para confirmar tus clases."
                    : `Vence el ${dateLabel(due.due_on)}`}
              </p>
              <Button asChild>
                <Link href={`/cuenta/plan/pagar/${due.id}`}>Pagar</Link>
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-fg-muted">
            {m.locked
              ? "Estás al día. La próxima cuota aparece cuando empiece a correr el mes que viene."
              : m.endsOn
                ? `Estás al día. Tu abono termina el ${dateLabel(m.endsOn)}.`
                : "Estás al día."}
          </p>
        )}
      </Section>

      <Section
        title="Intercambios"
        description="Propuestas para cambiar una clase con otra persona del abono."
        className="scroll-mt-24"
      >
        <div id="intercambios">
          <SwapInbox swaps={data.swaps} timezone={sector?.timezone ?? "America/Argentina/Buenos_Aires"} />
        </div>
      </Section>

      {history.length > 0 && (
        <Section title="Historial de cuotas">
          <ul className="surface-card divide-y divide-border">
            {history.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <span className="text-fg">{capFirst(monthLabel(p.period))}</span>
                <span className="flex items-center gap-3">
                  <span className="font-mono tabular-nums text-fg-muted">
                    {formatARS(p.amount_due_ars)}
                  </span>
                  <span
                    className={cn(
                      "text-xs",
                      p.status === "paid" ? "text-accent" : "text-fg-faint",
                    )}
                  >
                    {periodStatusLabel(p)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="mt-12 border-t border-border pt-6">
        <StopMembership
          membershipId={m.id}
          status={m.status}
          locked={m.locked}
          endsOn={m.endsOn}
        />
      </div>

      <PastList past={data.past} />
    </>
  );
}

function PastList({ past }: { past: PlanData["past"] }) {
  if (past.length === 0) return null;
  return (
    <Section title="Abonos anteriores">
      <ul className="surface-card divide-y divide-border">
        {past.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm text-fg-muted">
            <span>{p.plan}</span>
            <span className="text-xs text-fg-faint">
              {MEMBERSHIP_STATUS_LABEL[p.status]}
              {p.endsOn && ` · ${dateLabel(p.endsOn)}`}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
