import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatARS } from "@/lib/site";
import { LoadErrors } from "@/components/admin/load-errors";
import { SectionTitle, Stat } from "@/components/admin/stat";
import { PageShell } from "@/components/ui/page-shell";
import { cn } from "@/lib/utils";

const PERIODS = [
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
  { days: 365, label: "1 año" },
];

// Shape of public.admin_metrics() (see the admin_backoffice migration).
type Metrics = {
  days: number;
  unit: "day" | "week";
  users: { total: number; new: number; with_balance: number; credits_outstanding: number };
  bookings: { attended: number; no_show: number; cancelled: number; expired: number };
  upcoming: number;
  revenue: { total: number; count: number; bookings: number; packs: number };
  services: { name: string; count: number }[];
  series: { bucket: string; bookings: number; users: number; revenue: number }[];
};

function bucketLabel(bucket: string) {
  const [, m, d] = bucket.split("-");
  return `${Number(d)}/${Number(m)}`;
}

// A plain CSS bar chart: one column per day (or week). Exact values are in each
// bar's tooltip and summed in the heading, so no axis is needed.
function Bars({
  series,
  pick,
  format = String,
  unit,
}: {
  series: Metrics["series"];
  pick: (s: Metrics["series"][number]) => number;
  format?: (n: number) => string;
  unit: Metrics["unit"];
}) {
  const max = Math.max(1, ...series.map(pick));
  const first = series[0];
  const last = series[series.length - 1];
  return (
    <div>
      <div className="flex h-28 items-end gap-px">
        {series.map((s) => {
          const v = pick(s);
          return (
            <div
              key={s.bucket}
              title={`${unit === "week" ? "Semana del " : ""}${bucketLabel(s.bucket)}: ${format(v)}`}
              className="flex h-full min-w-0 flex-1 items-end"
            >
              <div
                className={cn(
                  "w-full rounded-t-sm",
                  v > 0 ? "bg-accent" : "bg-border",
                )}
                style={{ height: v > 0 ? `${Math.max(4, (v / max) * 100)}%` : "2px" }}
              />
            </div>
          );
        })}
      </div>
      {first && last && (
        <div className="mt-1.5 flex justify-between font-mono text-[11px] text-fg-faint">
          <span>{bucketLabel(first.bucket)}</span>
          <span>{unit === "week" ? "por semana" : "por día"}</span>
          <span>{bucketLabel(last.bucket)}</span>
        </div>
      )}
    </div>
  );
}

function pct(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

export default async function MetricasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = Number.parseInt(String(sp.dias ?? ""), 10);
  const days = PERIODS.some((p) => p.days === raw) ? raw : 30;

  const supabase = await createClient();
  // Admin check and the metrics in one round trip (the RPC is admin-gated itself).
  const [, { data, error }] = await Promise.all([
    requireAdmin(),
    supabase.rpc("admin_metrics", { p_days: days }),
  ]);
  const m = data as Metrics | null;

  const held = m ? m.bookings.attended + m.bookings.no_show : 0;
  const maxService = m ? Math.max(1, ...m.services.map((s) => s.count)) : 1;

  return (
    <PageShell size="wide" top="tight" eyebrow="Panel" title="Métricas">
      <LoadErrors errors={error ? [`Métricas: ${error.message}`] : []} />

      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p.days}
            href={p.days === 30 ? "/admin/metricas" : `/admin/metricas?dias=${p.days}`}
            aria-current={p.days === days ? "true" : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition-colors",
              p.days === days
                ? "border-accent bg-accent/10 font-semibold text-fg"
                : "border-border text-fg-muted hover:text-fg",
            )}
          >
            {p.label}
          </Link>
        ))}
      </div>

      {!m ? (
        <p className="mt-6 text-sm text-fg-faint">
          {error ? "—" : "Sin datos."}
        </p>
      ) : (
        <>
          <section className="mt-8">
            <SectionTitle>Clientes</SectionTitle>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Registrados" value={m.users.total} hint="en total" />
              <Stat label="Nuevos" value={m.users.new} hint="en el período" />
              <Stat
                label="Con saldo"
                value={m.users.with_balance}
                hint={
                  <Link href="/admin/clientes?saldo=1&orden=credits" className="text-accent hover:underline">
                    Ver quiénes →
                  </Link>
                }
              />
              <Stat
                label="Sesiones a favor"
                value={m.users.credits_outstanding}
                hint="pagas y sin usar"
              />
            </div>
            <div className="surface-card mt-3 p-5">
              <p className="mb-4 text-sm text-fg">
                Altas <span className="font-mono text-fg-faint">{m.users.new}</span>
              </p>
              <Bars series={m.series} pick={(s) => s.users} unit={m.unit} />
            </div>
          </section>

          <section className="mt-12">
            <SectionTitle>Turnos</SectionTitle>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Realizados" value={m.bookings.attended} hint="en el período" />
              <Stat
                label="Ausencias"
                value={m.bookings.no_show}
                hint={`${pct(m.bookings.no_show, held)} de los confirmados`}
              />
              <Stat
                label="Cancelados"
                value={m.bookings.cancelled}
                hint={`+ ${m.bookings.expired} sin pagar (vencidos)`}
              />
              <Stat label="Próximos" value={m.upcoming} hint="agendados a futuro" />
            </div>
            <div className="surface-card mt-3 p-5">
              <p className="mb-4 text-sm text-fg">
                Turnos confirmados <span className="font-mono text-fg-faint">{held}</span>
              </p>
              <Bars series={m.series} pick={(s) => s.bookings} unit={m.unit} />
            </div>
          </section>

          <section className="mt-12">
            <SectionTitle>Ingresos</SectionTitle>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Cobrado"
                value={formatARS(m.revenue.total)}
                hint={`${m.revenue.count} ${m.revenue.count === 1 ? "pago" : "pagos"}`}
              />
              <Stat label="Turnos" value={formatARS(m.revenue.bookings)} hint="pagos sueltos" />
              <Stat label="Packs" value={formatARS(m.revenue.packs)} hint="compras de pack" />
              <Stat
                label="Promedio"
                value={formatARS(
                  m.revenue.count > 0 ? Math.round(m.revenue.total / m.revenue.count) : 0,
                )}
                hint="por pago"
              />
            </div>
            <div className="surface-card mt-3 p-5">
              <p className="mb-4 text-sm text-fg">
                Cobrado{" "}
                <span className="font-mono text-fg-faint">{formatARS(m.revenue.total)}</span>
              </p>
              <Bars
                series={m.series}
                pick={(s) => s.revenue}
                format={formatARS}
                unit={m.unit}
              />
            </div>
            <p className="mt-2 text-xs text-fg-faint">
              Solo pagos aprobados y registrados en el sistema. Un turno confirmado a mano
              (efectivo) no suma acá.
            </p>
          </section>

          <section className="mt-12">
            <SectionTitle>Planes más reservados</SectionTitle>
            {m.services.length === 0 ? (
              <p className="mt-3 text-sm text-fg-faint">Sin turnos en el período.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {m.services.map((s) => (
                  <li key={s.name} className="surface-card px-5 py-3">
                    <div className="flex items-baseline justify-between gap-4 text-sm">
                      <span className="truncate text-fg">{s.name}</span>
                      <span className="font-mono tabular-nums text-fg-muted">{s.count}</span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-border">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${(s.count / maxService) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </PageShell>
  );
}
