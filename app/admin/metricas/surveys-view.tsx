import { createClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/format";
import { LoadErrors } from "@/components/admin/load-errors";
import { SectionTitle, Stat } from "@/components/admin/stat";
import { LEVEL_LABEL, PRE_KEYS, SCALES, type Level } from "@/lib/survey";
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
}: {
  sectorId: string;
  days: number;
  openId: string | null;
}) {
  const now = new Date();
  const to = localDate(now.toISOString());
  const from = localDate(new Date(now.getTime() - (days - 1) * 86_400_000).toISOString());

  const supabase = await createClient();
  const [{ data, error }, { data: recent, error: listError }] = await Promise.all([
    supabase.rpc("admin_survey_stats", { p_sector: sectorId, p_from: from, p_to: to }),
    supabase
      .from("session_surveys")
      .select("id, submitted_at, experience, nps, services(name), profiles(full_name)")
      .eq("sector_id", sectorId)
      .not("submitted_at", "is", null)
      .gte("submitted_at", `${from}T00:00:00-03:00`)
      .order("submitted_at", { ascending: false })
      .limit(50),
  ]);
  const s = data as Stats | null;
  const errors = [error && `Encuestas: ${error.message}`, listError && `Respuestas: ${listError.message}`].filter(
    Boolean,
  ) as string[];

  const items: SurveyListItem[] = ((recent ?? []) as unknown as {
    id: string;
    submitted_at: string;
    experience: number;
    nps: number;
    services: { name: string } | null;
    profiles: { full_name: string | null } | null;
  }[]).map((r) => ({
    id: r.id,
    submittedAt: r.submitted_at,
    client: r.profiles?.full_name ?? "Cliente",
    service: r.services?.name ?? "",
    experience: r.experience,
    nps: r.nps,
  }));

  // Stations grouped by plan, each plan's list already sorted by count.
  const plans = new Map<string, { station: string; count: number }[]>();
  for (const st of s?.stations ?? []) {
    plans.set(st.plan, [...(plans.get(st.plan) ?? []), st]);
  }

  return (
    <>
      <LoadErrors errors={errors} />
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

          <section className="mt-12">
            <SectionTitle>Respuestas</SectionTitle>
            <SurveyList items={items} openId={openId} />
          </section>
        </>
      )}
    </>
  );
}
