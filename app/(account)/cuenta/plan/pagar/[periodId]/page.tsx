import Link from "next/link";
import { MEMBERSHIP_ACTIVE } from "@/lib/booking-status";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { waLink } from "@/lib/site";
import {
  dateLabel,
  MEMBERSHIP_STATUS_LABEL,
  MEMBERSHIP_STATUS_STYLE,
  monthLabel,
  type MembershipPeriod,
  type MembershipStatus,
} from "@/lib/membership";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/ui/page-shell";
import { Button } from "@/components/ui/button";
import { PaymentPanel } from "@/components/payment/payment-panel";
import { HoldCountdown } from "@/components/hold-countdown";
import { MembershipScheduleChips } from "@/components/membership/schedule-chips";
import { PeriodAmount } from "@/components/membership/period-amount";
import type { TaloTransfer } from "@/components/talo-transfer-panel";

type MembershipRow = {
  id: string;
  status: MembershipStatus;
  locked: boolean;
  starts_on: string;
  ends_on: string | null;
  hold_expires_at: string | null;
  created_at: string;
  created_by: string | null;
  user_id: string;
  service_id: string;
  services: { name: string } | null;
  sectors: { name: string; due_day: number; late_fee_pct: number; release_day: number } | null;
  membership_slots: { weekday: number; start_time: string; resources: { name: string } | null }[];
};

// Pay one cuota (month) of an abono: the first one right after signup (with the
// schedule held), or any later month from Mi plan.
export default async function PagarCuotaPage({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  const { periodId } = await params;
  const supabase = await createClient();
  const [{ profile }, { data: per }, { data: taloRow }, { data: manualRow }] = await Promise.all([
    requireUser(`/cuenta/plan/pagar/${periodId}`),
    supabase
      .from("membership_periods_v")
      .select("*")
      .eq("id", periodId)
      .maybeSingle<MembershipPeriod & { membership_id: string; late_fee_pct: number }>(),
    supabase
      .from("payments")
      .select("talo_cvu, talo_alias, talo_expires_at, amount_ars")
      .eq("membership_period_id", periodId)
      .eq("provider", "talo")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("payments")
      .select("id")
      .eq("membership_period_id", periodId)
      .eq("provider", "manual")
      .eq("status", "pending")
      .limit(1)
      .maybeSingle(),
  ]);
  if (!per) notFound();

  const [{ data: mem }, { data: inFlight }] = await Promise.all([
    supabase
      .from("memberships")
      .select(
        "id, status, locked, starts_on, ends_on, hold_expires_at, created_at, created_by, user_id, service_id, services(name), sectors(name, due_day, late_fee_pct, release_day), membership_slots(weekday, start_time, resources(name))",
      )
      .eq("id", per.membership_id)
      .single<MembershipRow>(),
    supabase
      .from("bookings")
      .select("id")
      .eq("membership_id", per.membership_id)
      .eq("status", "awaiting_payment")
      .limit(1)
      .maybeSingle(),
  ]);
  if (!mem) notFound();

  const talo: TaloTransfer | null =
    taloRow && (taloRow.talo_cvu || taloRow.talo_alias)
      ? {
          cvu: (taloRow.talo_cvu as string) ?? null,
          alias: (taloRow.talo_alias as string) ?? null,
          amount: (taloRow.amount_ars as number) ?? 0,
          expiresAt: (taloRow.talo_expires_at as string) ?? null,
          paymentUrl: null,
        }
      : null;

  const sector = mem.sectors;
  const plan = mem.services?.name ?? "Abono";
  const slots = mem.membership_slots.map((s) => ({ ...s, resource_name: s.resources?.name }));
  const paid = per.status === "paid";
  const gone = per.status === "void" || !MEMBERSHIP_ACTIVE.includes(mem.status);
  const awaiting = Boolean(manualRow) || Boolean(inFlight);
  const showHold = mem.status === "pending" && Boolean(mem.hold_expires_at) && !paid && !gone;
  const adminHeld = mem.status === "pending" && !mem.hold_expires_at && mem.created_by !== mem.user_id;
  const firstName = (profile?.full_name ?? "").split(" ")[0];

  return (
    <PageShell size="wide" top="tight" eyebrow="Tu abono" title={plan}>
      <div className="surface-card surface-lift p-6">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-fg-muted">
            {per.period.slice(0, 7) === mem.starts_on.slice(0, 7)
              ? `Desde el ${dateLabel(mem.starts_on)}`
              : `Mes de ${monthLabel(per.period, false)}`}
          </p>
          <span
            className={cn(
              "shrink-0 rounded-md px-2 py-0.5 text-xs font-medium",
              MEMBERSHIP_STATUS_STYLE[mem.status],
            )}
          >
            {MEMBERSHIP_STATUS_LABEL[mem.status]}
          </span>
        </div>
        <MembershipScheduleChips className="mt-3" slots={slots} locked={mem.locked} />
        <div className="mt-5 border-t border-border pt-4">
          {sector && (
            <PeriodAmount
              period={per}
              lateFeePct={sector.late_fee_pct}
              dueDay={sector.due_day}
              size="lg"
            />
          )}
          {!paid && !gone && (
            <p className={cn("mt-2 text-xs", per.is_late ? "text-amber-300" : "text-fg-faint")}>
              {per.is_late
                ? `Venció el ${dateLabel(per.due_on)} · recargo aplicado`
                : showHold
                  ? "Se paga ahora para confirmar tus clases."
                  : `Vence el ${dateLabel(per.due_on)}.`}
            </p>
          )}
        </div>
      </div>

      {gone && !paid ? (
        <div className="surface-card mt-6 border-danger/30 bg-danger/5 p-5">
          <p className="font-semibold text-fg">Esta cuota ya no se puede pagar</p>
          <p className="mt-1 text-sm text-fg-muted">
            El abono venció o se dio de baja, y los horarios se liberaron.
          </p>
          <Link
            href={`/abono/${mem.service_id}`}
            className="mt-3 inline-block text-sm font-medium text-accent underline underline-offset-4"
          >
            Elegir horarios de nuevo
          </Link>
        </div>
      ) : paid ? (
        <div className="surface-card mt-6 p-6">
          <p className="font-semibold text-fg">Tu lugar está reservado ✓</p>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            La cuota de {monthLabel(per.period, false)} está paga. Te mandamos el detalle por
            email y tus clases ya están en Mis turnos.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button asChild size="lg" className="flex-1">
              <Link href="/cuenta/plan">Ver mi plan</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="flex-1">
              <a
                href={waLink(
                  `${firstName ? `Hola! Soy ${firstName}.` : "Hola!"} Acabo de sacar el abono de ${plan}.`,
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                Escribinos por WhatsApp
              </a>
            </Button>
          </div>
        </div>
      ) : (
        <>
          {showHold && (
            <HoldCountdown
              expiresAt={mem.hold_expires_at!}
              startedAt={mem.created_at}
              expiredHref={`/abono/${mem.service_id}`}
              expiredLabel="Elegir horarios de nuevo"
              hint="Completá el pago antes de que termine el tiempo para asegurar tus horarios."
            />
          )}
          <PaymentPanel
            target={{ membership_period_id: per.id }}
            receiptPrefix={`abono-${per.id}`}
            amount={per.amount_due_ars}
            awaiting={awaiting}
            talo={talo}
            what="tu abono"
          />
          {adminHeld && (
            <p className="mt-3 text-center text-xs text-fg-faint">
              Si pagás en efectivo en el estudio, el equipo lo marca y se confirma solo.
            </p>
          )}
        </>
      )}

      <div className="mt-8 flex justify-center">
        <Link href="/cuenta/plan" className="text-sm text-fg-muted underline-offset-4 hover:underline">
          Ir a Mi abono
        </Link>
      </div>
    </PageShell>
  );
}
