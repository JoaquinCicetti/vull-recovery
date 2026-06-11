"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, format, isAfter, isBefore, parse } from "date-fns";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fmtTime, fmtDayLabel, DEFAULT_TZ } from "@/lib/format";
import type { Service, Slot } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MiniCalendar,
  MiniCalendarDay,
  MiniCalendarDays,
  MiniCalendarNavigation,
} from "@/components/kibo-ui/mini-calendar";

type Day = { date: string; slots: Slot[] };
type AvailabilityResponse = { days?: Day[]; timezone?: string };

const VISIBLE_DAYS = 7;

// Split a day's slots into parts-of-day so a long list reads as a schedule, not
// a wall of buttons. Uses the salon-timezone hour (parsed from the formatted
// "HH:MM"), so it stays correct regardless of the viewer's own timezone.
type Period = { key: string; label: string; slots: Slot[] };
function groupByPeriod(slots: Slot[], tz: string): Period[] {
  const groups: Record<string, Slot[]> = { manana: [], tarde: [], noche: [] };
  for (const slot of slots) {
    const hour = Number(fmtTime(slot.starts_at, tz).slice(0, 2));
    const key = hour < 12 ? "manana" : hour < 18 ? "tarde" : "noche";
    groups[key].push(slot);
  }
  return [
    { key: "manana", label: "Mañana", slots: groups.manana },
    { key: "tarde", label: "Tarde", slots: groups.tarde },
    { key: "noche", label: "Noche", slots: groups.noche },
  ].filter((g) => g.slots.length > 0);
}

// Availability dates are plain "YYYY-MM-DD" strings in the salon's timezone.
// Parse/format them as *local* dates — `new Date("YYYY-MM-DD")` would parse as
// UTC midnight and shift a day in UTC-3.
const toDate = (s: string) => parse(s, "yyyy-MM-dd", new Date());
const toStr = (d: Date) => format(d, "yyyy-MM-dd");

async function readError(error: unknown): Promise<string> {
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json();
      if (body?.error) return body.error as string;
    }
  } catch {
    /* ignore */
  }
  return "Algo salió mal. Probá de nuevo.";
}

export function BookingFlow({
  service,
  isAuthed,
}: {
  service: Service;
  isAuthed: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [days, setDays] = useState<Day[] | null>(null);
  const [tz, setTz] = useState(DEFAULT_TZ);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function apply(data: AvailabilityResponse) {
    const ds: Day[] = data.days ?? [];
    setDays(ds);
    setTz(data.timezone ?? DEFAULT_TZ);
    setActiveDay(ds[0]?.date ?? null);
    setStartDate(ds[0] ? toDate(ds[0].date) : null);
  }

  async function reload() {
    setLoading(true);
    setError(null);
    setSelected(null);
    const { data, error } = await supabase.functions.invoke("availability", {
      body: { service_id: service.id },
    });
    setLoading(false);
    if (error) {
      setError("No pudimos cargar los horarios disponibles.");
      return;
    }
    apply(data ?? {});
  }

  useEffect(() => {
    let active = true;
    supabase.functions
      .invoke("availability", { body: { service_id: service.id } })
      .then(({ data, error }) => {
        if (!active) return;
        setLoading(false);
        if (error) {
          setError("No pudimos cargar los horarios disponibles.");
          return;
        }
        apply(data ?? {});
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service.id]);

  async function confirm() {
    if (!selected) return;
    if (!isAuthed) {
      router.push(`/login?next=${encodeURIComponent(`/reservar/${service.id}`)}`);
      return;
    }
    setSubmitting(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke("create-booking", {
      body: { service_id: service.id, starts_at: selected.starts_at },
    });
    setSubmitting(false);
    if (error) {
      setError(await readError(error));
      reload();
      return;
    }
    const bookingId = data?.booking?.id;
    if (bookingId) router.push(`/turno/${bookingId}`);
  }

  const day = days?.find((d) => d.date === activeDay);
  const available = new Set(days?.map((d) => d.date));
  const firstDate = days?.length ? toDate(days[0].date) : null;
  const lastDate = days?.length ? toDate(days[days.length - 1].date) : null;

  // Keep the visible window inside the availability range.
  const clampStart = (date: Date | undefined) => {
    if (!date || !firstDate || !lastDate) return;
    let next = date;
    if (isBefore(next, firstDate)) next = firstDate;
    const lastWindowStart = addDays(lastDate, -(VISIBLE_DAYS - 1));
    if (isAfter(next, lastWindowStart)) {
      next = isBefore(lastWindowStart, firstDate) ? firstDate : lastWindowStart;
    }
    setStartDate(next);
  };

  const atStart = !startDate || !firstDate || !isAfter(startDate, firstDate);
  const atEnd =
    !startDate ||
    !lastDate ||
    !isBefore(addDays(startDate, VISIBLE_DAYS - 1), lastDate);

  return (
    <div className="mt-10">
      <p className="eyebrow">Elegí un horario</p>

      {loading && (
        <div className="mt-4 flex flex-col gap-4" aria-hidden="true">
          <Skeleton className="h-[72px] w-full rounded-lg" />
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[42px] rounded-md" />
            ))}
          </div>
        </div>
      )}

      {!loading && days && days.length === 0 && (
        <p className="mt-4 text-sm text-fg-faint">
          No hay horarios disponibles por ahora. Probá más tarde.
        </p>
      )}

      {!loading && days && days.length > 0 && startDate && (
        <>
          {/* Day selector — full-width week strip */}
          <MiniCalendar
            className="surface-lift mt-4 w-full animate-fade-in"
            days={VISIBLE_DAYS}
            value={activeDay ? toDate(activeDay) : undefined}
            onValueChange={(date) => {
              if (!date) return;
              setActiveDay(toStr(date));
              setSelected(null);
            }}
            startDate={startDate}
            onStartDateChange={clampStart}
          >
            <MiniCalendarNavigation direction="prev" disabled={atStart} />
            <MiniCalendarDays>
              {(date) => (
                <MiniCalendarDay
                  key={toStr(date)}
                  date={date}
                  disabled={!available.has(toStr(date))}
                />
              )}
            </MiniCalendarDays>
            <MiniCalendarNavigation direction="next" disabled={atEnd} />
          </MiniCalendar>

          {activeDay && (
            <p className="mt-5 text-sm capitalize text-fg-muted">
              {fmtDayLabel(activeDay)}
            </p>
          )}

          {/* Slots, grouped by part of day */}
          {day && day.slots.length > 0 ? (
            <div className="mt-4 flex flex-col gap-5">
              {groupByPeriod(day.slots, tz).map((period) => (
                <div key={period.key} className="animate-fade-in">
                  <div className="flex items-baseline gap-2">
                    <p className="eyebrow">{period.label}</p>
                    <span className="font-mono text-[11px] text-fg-faint">
                      {period.slots.length}
                    </span>
                  </div>
                  <div className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {period.slots.map((slot) => {
                      const isSel = selected?.starts_at === slot.starts_at;
                      return (
                        <Button
                          key={slot.starts_at}
                          type="button"
                          variant={isSel ? "default" : "outline"}
                          onClick={() => setSelected(slot)}
                          className={cn(
                            "font-mono font-normal tabular-nums",
                            isSel && "ring-2 ring-accent/30 ring-offset-0",
                          )}
                        >
                          {isSel && <Check className="size-3.5" />}
                          {fmtTime(slot.starts_at, tz)}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-fg-faint">
              No quedan horarios este día. Probá otro.
            </p>
          )}

          {/* Confirm — sticky on mobile so booking stays one-handed */}
          <div className="sticky bottom-0 z-10 -mx-5 mt-8 border-t border-border bg-bg/95 px-5 py-4 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
            <Button
              size="lg"
              onClick={confirm}
              disabled={!selected || submitting}
              className="w-full"
            >
              {submitting
                ? "Reservando…"
                : isAuthed
                  ? selected
                    ? `Reservar ${fmtTime(selected.starts_at, tz)}`
                    : "Elegí un horario"
                  : "Ingresar y reservar"}
            </Button>
          </div>
        </>
      )}

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
    </div>
  );
}
