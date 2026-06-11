"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, format, isAfter, isBefore, parse } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { fmtTime, fmtDayLabel, DEFAULT_TZ } from "@/lib/format";
import type { Service, Slot } from "@/lib/types";
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

const VISIBLE_DAYS = 5;

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
          {/* Day selector */}
          <MiniCalendar
            className="mt-4 w-fit max-w-full animate-fade-in bg-card"
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
            <MiniCalendarDays className="overflow-x-auto">
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
            <p className="mt-4 text-sm capitalize text-fg-muted">
              {fmtDayLabel(activeDay)}
            </p>
          )}

          {/* Slots */}
          <div className="mt-3 grid animate-fade-in grid-cols-3 gap-2 sm:grid-cols-4">
            {day?.slots.map((slot) => {
              const isSel = selected?.starts_at === slot.starts_at;
              return (
                <Button
                  key={slot.starts_at}
                  type="button"
                  variant={isSel ? "default" : "outline"}
                  onClick={() => setSelected(slot)}
                  className="font-mono font-normal"
                >
                  {fmtTime(slot.starts_at, tz)}
                </Button>
              );
            })}
          </div>

          <Button
            size="lg"
            onClick={confirm}
            disabled={!selected || submitting}
            className="mt-8 w-full"
          >
            {submitting
              ? "Reservando…"
              : isAuthed
                ? "Reservar este horario"
                : "Ingresar y reservar"}
          </Button>
        </>
      )}

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
    </div>
  );
}
