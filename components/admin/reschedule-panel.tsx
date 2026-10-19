"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { readError } from "@/lib/read-error";
import { fmtTime, fmtDayLabel, DEFAULT_TZ } from "@/lib/format";
import type { Slot } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Day = { date: string; slots: Slot[] };

// Slot picker for admin reschedule: fetches availability for the booking's
// service and moves the turno to the chosen slot via admin-booking. Admin
// scope: slots beyond the client booking window are offered too. Picking a
// time asks once more (the move is immediate and notifies the client).
export function ReschedulePanel({
  bookingId,
  serviceId,
  onDone,
}: {
  bookingId: string;
  serviceId: string;
  onDone: () => void;
}) {
  const supabase = createClient();
  const [days, setDays] = useState<Day[] | null>(null);
  const [tz, setTz] = useState(DEFAULT_TZ);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.functions
      .invoke("availability", { body: { service_id: serviceId, scope: "admin" } })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setError("No se pudieron cargar horarios.");
          setDays([]);
          return;
        }
        const ds: Day[] = data?.days ?? [];
        setDays(ds);
        setTz(data?.timezone ?? DEFAULT_TZ);
        setActiveDay(ds[0]?.date ?? null);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  async function move() {
    if (!slot) return;
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.functions.invoke("admin-booking", {
      body: { booking_id: bookingId, action: "reschedule", starts_at: slot.starts_at },
    });
    setSubmitting(false);
    if (error) {
      setError(await readError(error, "No se pudo reprogramar."));
      return;
    }
    onDone();
  }

  const day = days?.find((d) => d.date === activeDay);

  if (days === null) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (days.length === 0) {
    return (
      <p className={cn("text-sm", error ? "text-danger" : "text-fg-faint")}>
        {error ?? "No hay horarios disponibles."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {days.map((d) => (
          <Button
            key={d.date}
            type="button"
            size="sm"
            variant={d.date === activeDay ? "default" : "outline"}
            aria-pressed={d.date === activeDay}
            onClick={() => {
              setActiveDay(d.date);
              setSlot(null);
            }}
            className="shrink-0 capitalize"
          >
            {fmtDayLabel(d.date)}
          </Button>
        ))}
      </div>
      {day && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {day.slots.map((s) => {
            const sel = slot?.starts_at === s.starts_at;
            return (
              <Button
                key={s.starts_at}
                type="button"
                variant={sel ? "default" : "outline"}
                aria-pressed={sel}
                disabled={submitting}
                onClick={() => setSlot(s)}
                className="font-mono font-normal tabular-nums"
              >
                {fmtTime(s.starts_at, tz)}
              </Button>
            );
          })}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button disabled={!slot || submitting} onClick={move}>
        {submitting
          ? "Moviendo…"
          : slot
            ? `Mover al ${fmtDayLabel(activeDay!)} ${fmtTime(slot.starts_at, tz)}`
            : "Elegí un horario"}
      </Button>
    </div>
  );
}
