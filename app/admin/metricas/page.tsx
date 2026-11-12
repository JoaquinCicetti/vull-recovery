import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatARS } from "@/lib/site";
import { LoadErrors } from "@/components/admin/load-errors";
import { SectionTitle, Stat } from "@/components/admin/stat";
import { Segmented } from "@/components/admin/segmented";
import { SurveysView } from "./surveys-view";
import { PageShell } from "@/components/ui/page-shell";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Métricas" };

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
  // Encuestas is a view of Métricas, not a tab (four sections, ADR 0017).
  const surveys = sp.ver === "encuestas";
  const openId = typeof sp.r === "string" ? sp.r : null;

  const supabase = await createClient();
  // Admin check and the data in one round trip (the RPCs are admin-gated themselves).
  const [, { data, error }, { data: surveySectors }] = await Promise.all([
    requireAdmin(),
    surveys
      ? Promise.resolve({ data: null, error: null })
      : supabase.rpc("admin_metrics", { p_days: days }),
    supabase
      .from("sectors")
      .select("id, slug, name")
      .eq("survey_enabled", true)
      .order("sort_order"),
  ]);
  const m = data as Metrics | null;

  // Sectors never share a screen: the surveys view is one sector at a time.
  const sectors = (surveySectors ?? []) as { id: string; slug: string; name: string }[];
  const sector = sectors.find((x) => x.slug === sp.sector) ?? sectors[0] ?? null;
  const href = (o: { ver?: string; dias?: number; sector?: string }) => {
    const q = new URLSearchParams();
    const ver = o.ver ?? (surveys ? "encuestas" : undefined);
    const d = o.dias ?? days;
    const sec = o.sector ?? (surveys && sectors.length > 1 ? sector?.slug : undefined);
    if (ver === "encuestas") q.set("ver", "encuestas");
    if (d !== 30) q.set("dias", String(d));
    if (ver === "encuestas" && sec) q.set("sector", sec);
    const qs = q.toString();
    return qs ? `/admin/metricas?${qs}` : "/admin/metricas";
  };

  const held = m ? m.bookings.attended + m.bookings.no_show : 0;
  const maxService = m ? Math.max(1, ...m.services.map((s) => s.count)) : 1;

  return (
    <PageShell size="wide" top="tight" eyebrow="Panel" title="Métricas">
      <LoadErrors errors={error ? [`Métricas: ${error.message}`] : []} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          label="Vista"
          items={[
            { href: href({ ver: "general" }), label: "General", active: !surveys },
            { href: href({ ver: "encuestas" }), label: "Encuestas", active: surveys },
          ]}
        />
        {surveys && sectors.length > 1 && (
          <Segmented
            label="Sector"
            items={sectors.map((x) => ({
              href: href({ sector: x.slug }),
              label: x.name,
              active: x.id === sector?.id,
            }))}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p.days}
            href={href({ dias: p.days })}
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

      {surveys ? (
        sector ? (
          <SurveysView key={`${sector.id}-${days}`} sectorId={sector.id} days={days} openId={openId} />
        ) : (
          <p className="mt-6 text-sm text-fg-faint">Ningún sector tiene encuestas activadas (Ajustes).</p>
        )
      ) : !m ? (
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
