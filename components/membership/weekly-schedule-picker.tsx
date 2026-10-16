"use client";

import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { readError } from "@/lib/read-error";
import {
  WEEK_ORDER,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  type MembershipAvailability,
  type SchedulePick,
} from "@/lib/membership";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type Weekday = MembershipAvailability["weekdays"][number];
type Time = Weekday["times"][number];

const PARTS = [
  { key: "manana", label: "Mañana", test: (h: number) => h < 12 },
  { key: "tarde", label: "Tarde", test: (h: number) => h >= 12 && h < 18 },
  { key: "noche", label: "Noche", test: (h: number) => h >= 18 },
];

function freeFor(data: MembershipAvailability, p: Pick<SchedulePick, "weekday" | "start_time">) {
  return (
    data.weekdays
      .find((w) => w.weekday === p.weekday)
      ?.times.find((t) => t.start_time === p.start_time)?.resources_free ?? []
  );
}

// Give every pick a bed: the same bed on every day when one is free on all of
// them (keeping the current one if it still is), otherwise each day keeps its
// own bed when free, or gets the first free one.
function assignBeds(
  picks: SchedulePick[],
  data: MembershipAvailability,
  sameBed: boolean,
): SchedulePick[] {
  const order = data.resources.map((r) => r.id);
  const frees = picks.map((p) => freeFor(data, p));
  if (sameBed && picks.length) {
    const common = order.filter((id) => frees.every((f) => f.includes(id)));
    if (common.length) {
      const current = picks[0].resource_id;
      const keep = picks.every((p) => p.resource_id === current) && common.includes(current);
      const bed = keep ? current : common[0];
      return picks.map((p) => ({ ...p, resource_id: bed }));
    }
  }
  return picks.map((p, i) =>
    frees[i].includes(p.resource_id)
      ? p
      : { ...p, resource_id: order.find((id) => frees[i].includes(id)) ?? "" },
  );
}

// The weekly schedule of an abono: pick N weekdays, a time for each, and a bed.
// Two levels so it fits a phone: a row of 7 weekday chips, then the times of
// the weekday being edited. Availability comes from membership-availability
// (free beds across every occurrence the abono would take).
export function WeeklySchedulePicker({
  serviceId,
  startsOn,
  locked,
  classesPerWeek,
  value,
  onChange,
  onData,
  adminMode = false,
}: {
  serviceId: string;
  startsOn: string;
  locked: boolean;
  classesPerWeek: number;
  value: SchedulePick[];
  onChange: (next: SchedulePick[]) => void;
  onData?: (data: MembershipAvailability | null) => void;
  adminMode?: boolean;
}) {
  const supabase = createClient();
  const [data, setData] = useState<MembershipAvailability | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which request the shown data answers; anything else is still loading.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [sameBed, setSameBed] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const requestKey = `${serviceId}|${startsOn}|${locked}|${reloadKey}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let live = true;
    supabase.functions
      .invoke("membership-availability", {
        body: { service_id: serviceId, starts_on: startsOn, locked },
      })
      .then(async ({ data: res, error: err }) => {
        if (!live) return;
        setLoadedKey(requestKey);
        if (err || !res) {
          setError(await readError(err, "No pudimos cargar los horarios."));
          setData(null);
          onData?.(null);
          return;
        }
        const d = res as MembershipAvailability;
        setError(null);
        setData(d);
        onData?.(d);
        // Drop picks that are no longer offered, re-seat the rest.
        const kept = value.filter((p) => freeFor(d, p).length > 0);
        if (kept.length !== value.length) {
          setNotice(
            locked
              ? "Algunos horarios que habías elegido no están libres todos los meses. Elegí otros."
              : "Algunos horarios que habías elegido ya no están libres. Elegí otros.",
          );
        }
        const next = assignBeds(kept, d, sameBed);
        if (JSON.stringify(next) !== JSON.stringify(value)) onChange(next);
        setActive((cur) => {
          if (cur !== null && d.weekdays.some((w) => w.weekday === cur)) return cur;
          return WEEK_ORDER.find((w) => d.weekdays.some((x) => x.weekday === w)) ?? null;
        });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, startsOn, locked, reloadKey]);

  const byWeekday = useMemo(
    () => new Map((data?.weekdays ?? []).map((w) => [w.weekday, w])),
    [data],
  );
  const bedName = (id: string) => data?.resources.find((r) => r.id === id)?.name ?? "—";
  const picked = new Map(value.map((p) => [p.weekday, p]));
  const remaining = classesPerWeek - value.length;

  function choose(weekday: number, time: Time) {
    if (!data) return;
    setNotice(null);
    const isNewDay = !picked.has(weekday);
    if (isNewDay && value.length >= classesPerWeek) {
      setNotice(
        `Ya elegiste ${classesPerWeek} ${classesPerWeek === 1 ? "día" : "días"}. Quitá uno para cambiar.`,
      );
      return;
    }
    const others = value.filter((p) => p.weekday !== weekday);
    const next = assignBeds(
      [...others, { weekday, start_time: time.start_time, resource_id: picked.get(weekday)?.resource_id ?? "" }],
      data,
      sameBed,
    );
    onChange(next);
    // Move on to the next open weekday still unpicked.
    if (next.length < classesPerWeek) {
      const from = WEEK_ORDER.indexOf(weekday);
      const rotated = [...WEEK_ORDER.slice(from + 1), ...WEEK_ORDER.slice(0, from)];
      const nextDay = rotated.find(
        (w) => byWeekday.has(w) && !next.some((p) => p.weekday === w),
      );
      if (nextDay !== undefined) setActive(nextDay);
    }
  }

  function remove(weekday: number) {
    setNotice(null);
    onChange(value.filter((p) => p.weekday !== weekday));
  }

  function setBed(weekday: number | "all", bed: string) {
    onChange(
      value.map((p) => (weekday === "all" || p.weekday === weekday ? { ...p, resource_id: bed } : p)),
    );
  }

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-4" aria-hidden="true">
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-md" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[42px] rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <p role="alert" className="text-sm text-danger">
          {error ?? "No pudimos cargar los horarios."}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => setReloadKey((k) => k + 1)}
        >
          Reintentar
        </Button>
      </div>
    );
  }

  if (data.weekdays.length === 0) {
    return (
      <p className="text-sm text-fg-faint">
        No hay horarios libres para empezar en esa fecha. Probá otra fecha de inicio o
        escribinos.
      </p>
    );
  }

  const activeDay = active !== null ? byWeekday.get(active) : undefined;
  const activePick = active !== null ? picked.get(active) : undefined;
  const commonBeds = data.resources.filter((r) =>
    value.length > 0 && value.every((p) => freeFor(data, p).includes(r.id)),
  );
  const allSame = value.length > 0 && value.every((p) => p.resource_id === value[0].resource_id);

  return (
    <div className={cn("flex flex-col gap-6", loading && "opacity-60")}>
      {/* ── weekdays ── */}
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="eyebrow">
            Elegí {classesPerWeek} {classesPerWeek === 1 ? "día" : "días"}
          </p>
          <span className="font-mono text-xs text-fg-faint" aria-live="polite">
            {value.length} de {classesPerWeek}
          </span>
        </div>
        <div className="mt-2.5 grid grid-cols-7 gap-1.5">
          {WEEK_ORDER.map((w) => {
            const open = byWeekday.has(w);
            const p = picked.get(w);
            const isActive = active === w;
            return (
              <button
                key={w}
                type="button"
                disabled={!open}
                aria-pressed={Boolean(p)}
                aria-label={
                  !open
                    ? `${WEEKDAY_LONG[w]}, cerrado`
                    : p
                      ? `${WEEKDAY_LONG[w]}, ${p.start_time}, ${bedName(p.resource_id)}`
                      : WEEKDAY_LONG[w]
                }
                onClick={() => setActive(w)}
                className={cn(
                  "flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-md border text-xs transition-colors",
                  !open && "cursor-not-allowed border-border/50 text-fg-faint",
                  open && !p && "border-border bg-surface text-fg hover:border-border-strong",
                  p && "border-accent bg-accent font-semibold text-on-accent",
                  isActive && "ring-2 ring-accent/40 ring-offset-1 ring-offset-bg",
                )}
              >
                <span>{WEEKDAY_SHORT[w]}</span>
                <span className={cn("font-mono text-[10px] tabular-nums", !p && "text-fg-faint")}>
                  {!open ? "Cerr." : p ? p.start_time : "—"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── times of the weekday being edited ── */}
      {activeDay && (
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm text-fg-muted">
              <span className="font-medium text-fg">{WEEKDAY_LONG[activeDay.weekday]}</span> · elegí
              un horario
            </p>
            {activePick && (
              <button
                type="button"
                onClick={() => remove(activeDay.weekday)}
                className="text-xs text-fg-faint underline underline-offset-4 hover:text-fg-muted"
              >
                Quitar {WEEKDAY_LONG[activeDay.weekday].toLowerCase()}
              </button>
            )}
          </div>
          <div className="mt-3 flex flex-col gap-4">
            {PARTS.map((part) => {
              const times = activeDay.times.filter((t) => part.test(Number(t.start_time.slice(0, 2))));
              if (times.length === 0) return null;
              return (
                <div key={part.key}>
                  <p className="eyebrow">{part.label}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {times.map((t) => {
                      const sel = activePick?.start_time === t.start_time;
                      const free = t.resources_free.length;
                      return (
                        <Button
                          key={t.start_time}
                          type="button"
                          variant={sel ? "default" : "outline"}
                          disabled={free === 0}
                          onClick={() => choose(activeDay.weekday, t)}
                          aria-label={`${t.start_time}, ${free === 0 ? "sin lugar" : `${free} ${free === 1 ? "cama libre" : "camas libres"}`}`}
                          className={cn(
                            "font-mono font-normal tabular-nums",
                            sel && "ring-2 ring-accent/30 ring-offset-0",
                          )}
                        >
                          {sel && <Check className="size-3.5" aria-hidden />}
                          {t.start_time}
                          <span className={cn("text-[10px]", sel ? "opacity-80" : "text-fg-faint")}>
                            ·{free}
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-fg-faint">
            El número es la cantidad de camas libres
            {locked ? " todas las semanas de este mes y del próximo." : " todas las semanas del mes."}
          </p>
        </div>
      )}

      {/* ── bed ── */}
      {value.length > 0 && (
        <div>
          <p className="eyebrow">Cama</p>
          {sameBed && commonBeds.length > 0 ? (
            <>
              <p className="mt-2 text-sm text-fg-muted">
                {allSame ? (
                  <>
                    <span className="font-medium text-fg">{bedName(value[0].resource_id)}</span>, la
                    misma todos los días.
                  </>
                ) : (
                  "Elegí tu cama."
                )}
              </p>
              {commonBeds.length > 1 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {commonBeds.map((r) => (
                    <Button
                      key={r.id}
                      type="button"
                      size="sm"
                      variant={allSame && value[0].resource_id === r.id ? "default" : "outline"}
                      aria-pressed={allSame && value[0].resource_id === r.id}
                      onClick={() => setBed("all", r.id)}
                    >
                      {r.name}
                    </Button>
                  ))}
                </div>
              )}
              {value.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSameBed(false)}
                  className="mt-3 text-xs text-fg-faint underline underline-offset-4 hover:text-fg-muted"
                >
                  Elegir una cama distinta por día
                </button>
              )}
            </>
          ) : (
            <>
              {commonBeds.length === 0 && value.length > 1 && (
                <p className="mt-2 text-sm text-fg-muted">
                  No hay una misma cama libre todos los días: elegí una para cada uno.
                </p>
              )}
              <ul className="mt-2.5 flex flex-col gap-2">
                {[...value]
                  .sort((a, b) => WEEK_ORDER.indexOf(a.weekday) - WEEK_ORDER.indexOf(b.weekday))
                  .map((p) => (
                    <li key={p.weekday} className="flex flex-wrap items-center gap-2">
                      <span className="w-24 shrink-0 text-sm text-fg">
                        {WEEKDAY_SHORT[p.weekday]}{" "}
                        <span className="font-mono text-fg-muted">{p.start_time}</span>
                      </span>
                      {data.resources
                        .filter((r) => freeFor(data, p).includes(r.id))
                        .map((r) => (
                          <Button
                            key={r.id}
                            type="button"
                            size="sm"
                            variant={p.resource_id === r.id ? "default" : "outline"}
                            aria-pressed={p.resource_id === r.id}
                            onClick={() => setBed(p.weekday, r.id)}
                          >
                            {r.name}
                          </Button>
                        ))}
                    </li>
                  ))}
              </ul>
              {commonBeds.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSameBed(true);
                    onChange(assignBeds(value, data, true));
                  }}
                  className="mt-3 text-xs text-fg-faint underline underline-offset-4 hover:text-fg-muted"
                >
                  Usar la misma cama todos los días
                </button>
              )}
            </>
          )}
          {!adminMode && (
            <p className="mt-2 text-xs text-fg-faint">
              Es tu lugar fijo en esos horarios mientras tengas el abono.
            </p>
          )}
        </div>
      )}

      {notice && (
        <p role="alert" className="text-sm text-amber-300">
          {notice}
        </p>
      )}
      {remaining > 0 && value.length > 0 && (
        <p className="sr-only" aria-live="polite">
          Falta elegir {remaining} {remaining === 1 ? "día" : "días"}.
        </p>
      )}
    </div>
  );
}
