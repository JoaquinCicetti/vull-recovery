import Link from "next/link";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Section } from "@/components/account/section";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SOON_DAYS = 7;

// credit_ledger.reason, in the client's words.
const MOVEMENT: Record<string, string> = {
  purchase: "Compraste un pack",
  booking_consume: "Reservaste un turno",
  booking_refund: "Cancelaste un turno",
  cancel_credit: "Cancelaste un turno pago",
  admin_adjust: "Ajuste de VULL",
  revoke: "Sesiones retiradas",
};

export type SessionBalance = {
  serviceId: string;
  name: string;
  bookable: boolean;
  remaining: number;
  expiresAt: string | null;
  expired: boolean;
  daysLeft: number | null;
};

export type SessionMovement = {
  id: string;
  delta: number;
  reason: string;
  service: string;
  createdAt: string;
};

// Everything under the "Sesiones" title: the total, each plan's balance and
// expiry, the rules, and the movement history.
export function SesionesView({
  balances,
  movements,
}: {
  balances: SessionBalance[];
  movements: SessionMovement[];
}) {
  const live = balances.filter((c) => !c.expired);
  const lapsed = balances.filter((c) => c.expired);
  const total = live.reduce((n, c) => n + c.remaining, 0);
  return (
    <>
      <div className="surface-card surface-lift animate-fade-up flex flex-wrap items-end justify-between gap-5 p-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
            A favor
          </p>
          <p className="mt-3 flex items-baseline gap-3">
            <span
              className={cn(
                "font-mono text-6xl font-bold leading-none tracking-tight tabular-nums",
                total > 0 ? "text-accent" : "text-fg-faint",
              )}
            >
              {total}
            </span>
            <span className="text-sm text-fg-muted">
              {total === 1 ? "sesión para usar" : "sesiones para usar"}
            </span>
          </p>
        </div>
        <Button asChild variant={total > 0 ? "outline" : "default"}>
          <Link href="/planes">{total > 0 ? "Comprar más" : "Ver planes"}</Link>
        </Button>
      </div>

      {live.length > 0 && (
        <Section title="Por plan">
          <ul className="stagger-children flex flex-col gap-3">
            {live.map((c) => {
              const soon = c.daysLeft != null && c.daysLeft <= SOON_DAYS;
              return (
                <li
                  key={c.serviceId}
                  className="surface-card flex flex-wrap items-center gap-4 p-5"
                >
                  <span className="w-12 shrink-0 font-mono text-3xl font-bold leading-none tabular-nums text-fg">
                    {c.remaining}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-fg">{c.name}</p>
                    <p
                      className={cn(
                        "mt-0.5 text-sm",
                        soon ? "text-amber-300" : "text-fg-muted",
                      )}
                    >
                      {c.expiresAt
                        ? soon
                          ? `Vencen ${c.daysLeft === 1 ? "mañana" : `en ${c.daysLeft} días`} · ${fmtDate(c.expiresAt)}`
                          : `Vencen el ${fmtDate(c.expiresAt)}`
                        : "Sin vencimiento"}
                    </p>
                  </div>
                  {c.bookable && (
                    <Button asChild size="sm">
                      <Link href={`/reservar/${c.serviceId}`}>Reservar</Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {lapsed.length > 0 && (
        <Section title="Vencidas">
          <ul className="flex flex-col gap-2">
            {lapsed.map((c) => (
              <li
                key={c.serviceId}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border border-border px-5 py-3 text-sm text-fg-faint"
              >
                <span>
                  <span className="font-mono tabular-nums line-through">{c.remaining}</span>
                  {" · "}
                  {c.name}
                </span>
                <span className="text-xs">Vencieron el {fmtDate(c.expiresAt!)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Cómo funcionan">
        <ul className="surface-card divide-y divide-border text-sm text-fg-muted">
          <li className="px-5 py-3.5">
            <span className="font-medium text-fg">Un pack suma sesiones.</span> Cada turno
            que reservás de ese plan usa una, sin pagar de nuevo.
          </li>
          <li className="px-5 py-3.5">
            <span className="font-medium text-fg">Cancelar con 24 h de aviso</span> te
            devuelve la sesión, también si pagaste ese turno suelto.
          </li>
          <li className="px-5 py-3.5">
            <span className="font-medium text-fg">Algunos packs vencen.</span> La fecha
            figura arriba, junto a cada saldo.
          </li>
        </ul>
      </Section>

      <Section title="Movimientos">
        {movements.length === 0 ? (
          <p className="text-sm text-fg-faint">Todavía no hay movimientos.</p>
        ) : (
          <ul className="surface-card divide-y divide-border">
            {movements.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg">
                    {MOVEMENT[m.reason] ?? "Movimiento"}
                    <span className="text-fg-faint"> · {m.service}</span>
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-fg-faint">
                    {fmtDateTime(m.createdAt)}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 font-mono text-sm font-semibold tabular-nums",
                    m.delta > 0 ? "text-accent" : "text-fg-muted",
                  )}
                >
                  {m.delta > 0 ? `+${m.delta}` : m.delta}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
