import Link from "next/link";
import { Download, MessageSquareText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/format";
import { LoadErrors } from "@/components/admin/load-errors";
import { SectionTitle, Stat } from "@/components/admin/stat";
import { FilterDialog, FilterField } from "@/components/admin/filter-dialog";
import { Pager } from "@/components/admin/pager";
import { FIELD } from "@/components/admin/stat";
import { Button } from "@/components/ui/button";
import { LEVEL_LABEL, PRE_KEYS, SCALES, type Level, type ReviewStatus } from "@/lib/survey";
import { SurveyList, type SurveyListItem } from "./survey-list";

// Shape of public.admin_survey_stats() (session_surveys migration).
type Counts = { si: number; un_poco: number; no: number };
type Stats = {
  sent: number;
  answered: number;
  answered_after_send: number;
  avg: Record<string, number | null>;
  nps_score: number | null;
  tension: Counts;
  mobility: Counts;
  stations: { plan: string; station: string; count: number }[];
  other_stations: number;
  by_level: { level: Level; count: number; experience: number | null; nps: number | null }[];
};

/** ?opiniones= : the answers list narrowed by the state of its public comment. */
export const REVIEW_FILTERS = ["pendientes", "publicadas", "ocultas"] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];
const REVIEW_FILTER: Record<ReviewFilter, { status: ReviewStatus; label: string }> = {
  pendientes: { status: "pending", label: "Opiniones por aprobar" },
  publicadas: { status: "approved", label: "Opiniones publicadas" },
  ocultas: { status: "hidden", label: "Opiniones ocultas" },
};

const PAGE = 25;
const BASE = "/admin/metricas";

function hrefWith(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${BASE}?${s}` : BASE;
}

const fmt1 = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("es-AR"));

/** A 0–10 average as a horizontal meter. */
function MeterRow({ label, value }: { label: string; value: number | null }) {
  return (
    <li className="px-5 py-3">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="truncate text-fg-muted">{label}</span>
        <span className="font-mono font-semibold tabular-nums text-fg">{fmt1(value)}</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-border">
        <div className="h-full rounded-full bg-accent" style={{ width: `${((value ?? 0) / 10) * 100}%` }} />
      </div>
    </li>
  );
}

/** Sí / Un poco / No as one stacked bar. Green, dimmed green, neutral: one hue. */
function SplitRow({ label, c }: { label: string; c: Counts }) {
  const total = c.si + c.un_poco + c.no;
  const w = (n: number) => (total ? `${(n / total) * 100}%` : "0%");
  const p = (n: number) => (total ? `${Math.round((n / total) * 100)}%` : "—");
  return (
    <li className="px-5 py-3">
      <p className="text-sm text-fg-muted">{label}</p>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-border">
        <div className="bg-accent" style={{ width: w(c.si) }} title={`Sí: ${c.si}`} />
        <div className="bg-accent/40" style={{ width: w(c.un_poco) }} title={`Un poco: ${c.un_poco}`} />
        <div className="bg-fg-faint/40" style={{ width: w(c.no) }} title={`No: ${c.no}`} />
      </div>
      <div className="mt-1.5 flex gap-4 font-mono text-[11px] tabular-nums text-fg-faint">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-accent" /> Sí {p(c.si)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-accent/40" /> Un poco {p(c.un_poco)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-fg-faint/40" /> No {p(c.no)}
        </span>
      </div>
    </li>
  );
}

export async function SurveysView({
  sectorId,
  days,
  openId,
  review,
  page,
  params,
}: {
  sectorId: string;
  days: number;
  openId: string | null;
  review: ReviewFilter | null;
  page: number;
  /** The view's own query string (ver, dias, sector), carried by every link here. */
  params: Record<string, string | undefined>;
}) {
  const now = new Date();
  const to = localDate(now.toISOString());
  const from = localDate(new Date(now.getTime() - (days - 1) * 86_400_000).toISOString());

  const supabase = await createClient();
  let list = supabase
    .from("session_surveys")
    .select("id, submitted_at, experience, nps, rating, review_status, services(name), profiles(full_name)", {
      count: "exact",
    })
    .eq("sector_id", sectorId)
    .not("submitted_at", "is", null);
  // Comments waiting for approval are a queue: show them whatever the period.
  if (review !== "pendientes") list = list.gte("submitted_at", `${from}T00:00:00-03:00`);
  if (review) list = list.eq("review_status", REVIEW_FILTER[review].status);

  const [{ data, error }, { data: recent, error: listError, count }, { count: pending }] = await Promise.all([
    supabase.rpc("admin_survey_stats", { p_sector: sectorId, p_from: from, p_to: to }),
    list.order("submitted_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1),
    supabase
      .from("session_surveys")
      .select("id", { count: "exact", head: true })
      .eq("sector_id", sectorId)
      .eq("review_status", "pending"),
  ]);
  const total = count ?? 0;
  const listParams = { ...params, opiniones: review ?? undefined };
  const s = data as Stats | null;
  const errors = [error && `Encuestas: ${error.message}`, listError && `Respuestas: ${listError.message}`].filter(
    Boolean,
  ) as string[];

  const items: SurveyListItem[] = ((recent ?? []) as unknown as {
    id: string;
    submitted_at: string;
    experience: number;
    nps: number;
    rating: number | null;
    review_status: ReviewStatus | null;
    services: { name: string } | null;
    profiles: { full_name: string | null } | null;
  }[]).map((r) => ({
    id: r.id,
    submittedAt: r.submitted_at,
    client: r.profiles?.full_name ?? "Cliente",
    service: r.services?.name ?? "",
    experience: r.experience,
    nps: r.nps,
    rating: r.rating,
    review: r.review_status,
  }));

  const answers = (
    <section className="mt-12">
      <SectionTitle>Respuestas</SectionTitle>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <FilterDialog
          basePath={BASE}
          keep={params}
          active={review ? [{ key: "opiniones", label: REVIEW_FILTER[review].label, clearHref: hrefWith(params) }] : []}
          clearHref={hrefWith(params)}
        >
          <FilterField label="Opinión pública" htmlFor="f-opiniones">
            <select id="f-opiniones" name="opiniones" defaultValue={review ?? ""} className={FIELD}>
              <option value="">Todas las respuestas</option>
              {REVIEW_FILTERS.map((f) => (
                <option key={f} value={f}>
                  {REVIEW_FILTER[f].label}
                </option>
              ))}
            </select>
          </FilterField>
        </FilterDialog>
        {total > 0 && (
          <Button asChild variant="outline" size="sm">
            {/* A file download, not a page: a plain anchor, never prefetched. */}
            <a href={`${BASE}/encuestas.csv?${new URLSearchParams({ sector: sectorId, dias: String(days), ...(review ? { opiniones: review } : {}) })}`}>
              <Download data-icon="inline-start" aria-hidden />
              Exportar CSV
            </a>
          </Button>
        )}
      </div>
      <p className="mt-4 font-mono text-xs text-fg-faint">
        {total} {total === 1 ? "respuesta" : "respuestas"}
        {review === "pendientes" ? " · de cualquier fecha" : ""}
      </p>
      <SurveyList items={items} openId={openId} />
      <Pager basePath={BASE} params={listParams} page={page} pageSize={PAGE} total={total} />
    </section>
  );
  const emptyPeriod = Boolean(s) && s!.answered === 0 && s!.sent === 0;

  // Stations grouped by plan, each plan's list already sorted by count.
  const plans = new Map<string, { station: string; count: number }[]>();
  for (const st of s?.stations ?? []) {
    plans.set(st.plan, [...(plans.get(st.plan) ?? []), st]);
  }

  return (
    <>
      <LoadErrors errors={errors} />
      {(pending ?? 0) > 0 && review !== "pendientes" && (
        <Link
          href={hrefWith({ ...params, opiniones: "pendientes" })}
          className="surface-card group mt-6 flex items-center gap-3 border-accent/30 px-4 py-3 text-sm transition-colors duration-150 hover:border-accent/60"
        >
          <MessageSquareText className="size-4 shrink-0 text-accent" aria-hidden />
          <span className="flex-1 text-fg">
            {pending === 1
              ? "1 opinión pública espera tu aprobación"
              : `${pending} opiniones públicas esperan tu aprobación`}
          </span>
          <span className="text-fg-faint transition-colors group-hover:text-fg">Revisar</span>
        </Link>
      )}
      {!s ? (
        <p className="mt-6 text-sm text-fg-faint">{error ? "—" : "Sin datos."}</p>
      ) : s.answered === 0 && s.sent === 0 ? (
        <div className="surface-card mt-8 border-dashed p-8 text-center">
          <p className="font-semibold text-fg">Todavía no hay encuestas en este período</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">
            Enviálas desde Agenda › Turnos › Pasados: en el menú <span className="font-mono">…</span> de cada turno,
            «Enviar encuesta por WhatsApp».
          </p>
        </div>
      ) : (
        <>
          <section className="mt-8">
            <SectionTitle>Resumen</SectionTitle>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Respuestas"
                value={s.answered}
                hint={`${s.sent} ${s.sent === 1 ? "enviada" : "enviadas"} · ${
                  s.sent ? Math.round((s.answered_after_send / s.sent) * 100) : 0
                }% respondidas`}
              />
              <Stat
                label="NPS"
                value={s.nps_score == null ? "—" : `${s.nps_score > 0 ? "+" : ""}${s.nps_score}`}
                hint={`recomendaría: ${fmt1(s.avg.nps)}/10`}
              />
              <Stat label="Experiencia" value={fmt1(s.avg.experience)} hint="promedio, de 10" />
              <Stat label="Estado post-sesión" value={fmt1(s.avg.post_overall)} hint="promedio, de 10" />
            </div>
            <p className="mt-2 text-xs text-fg-faint">
              NPS = % que recomienda con 9–10 menos % con 0–6. Va de −100 a +100.
            </p>
          </section>

          {s.answered > 0 && (
            <>
              <section className="mt-12">
                <SectionTitle>Antes de la sesión · promedio</SectionTitle>
                <ul className="surface-card mt-3 divide-y divide-border">
                  {PRE_KEYS.map((k) => (
                    <MeterRow key={k} label={SCALES[k].label} value={s.avg[k] ?? null} />
                  ))}
                </ul>
              </section>

              <section className="mt-12">
                <SectionTitle>Después de la sesión</SectionTitle>
                <ul className="surface-card mt-3 divide-y divide-border">
                  <SplitRow label="Disminución de la tensión muscular" c={s.tension} />
                  <SplitRow label="Mayor movilidad" c={s.mobility} />
                </ul>
              </section>

              <section className="mt-12">
                <SectionTitle>Lo más beneficioso</SectionTitle>
                {plans.size === 0 ? (
                  <p className="mt-3 text-sm text-fg-faint">
                    Nadie eligió estaciones todavía.
                    {s.other_stations > 0 && ` ${s.other_stations} escribieron otra.`}
                  </p>
                ) : (
                  <div className="mt-3 flex flex-col gap-3">
                    {[...plans].map(([plan, list]) => {
                      const max = Math.max(1, ...list.map((x) => x.count));
                      return (
                        <div key={plan} className="surface-card p-5">
                          <p className="mb-3 text-sm font-semibold text-fg">{plan}</p>
                          <ul className="space-y-2.5">
                            {list.map((x) => (
                              <li key={x.station}>
                                <div className="flex items-baseline justify-between gap-4 text-sm">
                                  <span className="truncate text-fg-muted">{x.station}</span>
                                  <span className="font-mono tabular-nums text-fg">{x.count}</span>
                                </div>
                                <div className="mt-1.5 h-1.5 rounded-full bg-border">
                                  <div
                                    className="h-full rounded-full bg-accent"
                                    style={{ width: `${(x.count / max) * 100}%` }}
                                  />
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                    {s.other_stations > 0 && (
                      <p className="text-xs text-fg-faint">
                        + {s.other_stations} {s.other_stations === 1 ? "respuesta escribió" : "respuestas escribieron"} otra
                        (en el detalle de cada encuesta).
                      </p>
                    )}
                  </div>
                )}
              </section>

              <section className="mt-12">
                <SectionTitle>Por nivel</SectionTitle>
                <ul className="surface-card mt-3 divide-y divide-border">
                  {s.by_level.map((l) => (
                    <li key={l.level} className="flex items-center gap-4 px-5 py-3 text-sm">
                      <span className="flex-1 text-fg">{LEVEL_LABEL[l.level] ?? l.level}</span>
                      <span className="font-mono text-xs tabular-nums text-fg-faint">{l.count}</span>
                      <span className="w-24 text-right font-mono tabular-nums text-fg-muted">
                        Exp <span className="text-fg">{fmt1(l.experience)}</span>
                      </span>
                      <span className="w-24 text-right font-mono tabular-nums text-fg-muted">
                        Rec <span className="text-fg">{fmt1(l.nps)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

        </>
      )}
      {/* The list follows its own filter, so it shows even when the period's stats are empty. */}
      {(!emptyPeriod || total > 0 || review) && answers}
    </>
  );
}
