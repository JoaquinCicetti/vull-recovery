import Link from "next/link";
import { ArrowLeftRight, ArrowRight, Ticket } from "lucide-react";
import { fmtDateParts, fmtRelativeDay, fmtTime } from "@/lib/format";
import { BookingRow, type AccountBooking } from "@/components/account/booking-row";
import { Section } from "@/components/account/section";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";

const HISTORY_PREVIEW = 5;

// Everything under the "Mis turnos" title. Pure presentation: the page loads and
// splits the bookings, this lays them out.
export function TurnosView({
  upcoming,
  history,
  showAll,
  totalCredits,
  creditServiceId,
  nowISO,
  swapIncoming = 0,
}: {
  upcoming: AccountBooking[];
  history: AccountBooking[];
  showAll: boolean;
  totalCredits: number;
  /** A plan the client holds sessions for, to send "Reservar" straight there. */
  creditServiceId: string | null;
  nowISO: string;
  /** Pending swap offers other members sent this client. */
  swapIncoming?: number;
}) {
  const [next, ...later] = upcoming;
  const shownHistory = showAll ? history : history.slice(0, HISTORY_PREVIEW);
  return (
    <>
      {swapIncoming > 0 && (
        <Link
          href="/cuenta/plan#intercambios"
          className="surface-card group mb-3 flex items-center gap-3 border-accent/30 px-4 py-3 text-sm transition-colors duration-150 hover:border-accent/60"
        >
          <ArrowLeftRight className="size-4 shrink-0 text-accent" aria-hidden />
          <span className="flex-1 text-fg">
            Tenés {swapIncoming} {swapIncoming === 1 ? "propuesta" : "propuestas"} de intercambio
          </span>
          <span className="text-fg-faint transition-colors group-hover:text-fg">Ver</span>
          <ArrowRight className="size-4 text-fg-faint" aria-hidden />
        </Link>
      )}
      {next ? (
        <NextBooking b={next} nowISO={nowISO} />
      ) : (
        <div className="surface-card animate-fade-up border-dashed p-8 text-center">
          <p className="font-semibold text-fg">No tenés turnos próximos</p>
          <p className="mt-1 text-sm text-fg-muted">
            {totalCredits > 0
              ? `Tenés ${totalCredits} ${totalCredits === 1 ? "sesión" : "sesiones"} a favor para usar.`
              : "Elegí un plan y reservá tu próxima sesión."}
          </p>
          <Button asChild className="mt-5">
            <Link href={creditServiceId ? `/reservar/${creditServiceId}` : "/planes"}>
              Reservar un turno
            </Link>
          </Button>
        </div>
      )}

      {totalCredits > 0 && (
        <Link
          href="/cuenta/sesiones"
          className="surface-card group mt-3 flex items-center gap-3 px-4 py-3 text-sm transition-colors duration-150 hover:border-border-strong"
        >
          <Ticket className="size-4 shrink-0 text-accent" aria-hidden />
          <span className="flex-1 text-fg-muted">
            <span className="font-mono font-semibold text-fg">{totalCredits}</span>{" "}
            {totalCredits === 1 ? "sesión a favor" : "sesiones a favor"}
          </span>
          <span className="text-fg-faint transition-colors group-hover:text-fg">Ver</span>
          <ArrowRight className="size-4 text-fg-faint" aria-hidden />
        </Link>
      )}

      {later.length > 0 && (
        <Section title={`Próximos · ${later.length}`}>
          <ul className="stagger-children flex flex-col gap-3">
            {later.map((b) => (
              <li key={b.id}>
                <BookingRow b={b} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {history.length > 0 && (
        <Section title={`Historial · ${history.length}`}>
          <ul className="flex flex-col gap-3">
            {shownHistory.map((b) => (
              <li key={b.id}>
                <BookingRow b={b} dim />
              </li>
            ))}
          </ul>
          {history.length > shownHistory.length && (
            <Button asChild variant="ghost" size="sm" className="mt-3 text-fg-muted">
              <Link href="/mis-turnos?historial=todo" scroll={false}>
                Ver los {history.length}
              </Link>
            </Button>
          )}
        </Section>
      )}
    </>
  );
}

// The one turno that matters right now, as a readout: when, what, and — if it
// is still unpaid — the deadline and the way to pay.
function NextBooking({ b, nowISO }: { b: AccountBooking; nowISO: string }) {
  const { day, month, weekday, time } = fmtDateParts(b.startsAt);
  const unpaid = b.status === "pending";
  // An abono class is paid with the month's cuota, from Mi plan.
  const href = unpaid && b.membership ? "/cuenta/plan" : `/turno/${b.id}`;
  return (
    <div className="surface-card surface-lift animate-fade-up overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent">
          Próximo · {fmtRelativeDay(b.startsAt, nowISO)}
        </p>
        <StatusBadge status={b.status} />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-5 p-5">
        <div className="min-w-0">
          <p className="flex items-baseline gap-3">
            <span className="font-mono text-5xl font-bold leading-none tracking-tight tabular-nums text-fg">
              {time}
            </span>
            <span className="text-sm text-fg-muted">hs</span>
          </p>
          <p className="mt-3 text-fg">
            <span className="capitalize">{weekday}</span> {day} de {month}
          </p>
          <p className="mt-0.5 truncate text-sm text-fg-muted">
            {b.service}
            {b.place && <span className="text-fg-faint"> · {b.place}</span>}
          </p>
        </div>
        <Button asChild variant={unpaid ? "default" : "outline"}>
          <Link href={href}>
            {unpaid ? (b.membership ? "Pagar la cuota" : "Pagar ahora") : b.membership ? "Ver clase" : "Ver turno"}
          </Link>
        </Button>
      </div>
      {unpaid && b.holdExpiresAt && !b.membership && (
        <p className="border-t border-border bg-amber-400/5 px-5 py-2.5 text-xs text-amber-300">
          Reservado hasta las{" "}
          <span className="font-mono tabular-nums">{fmtTime(b.holdExpiresAt)}</span>. Si no
          se paga antes, el horario se libera.
        </p>
      )}
    </div>
  );
}
