"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtTime, fmtDayLabel, DEFAULT_TZ } from "@/lib/format";
import type { Slot } from "@/lib/types";
import { Button } from "@/components/ui/button";

type Day = { date: string; slots: Slot[] };

async function readError(error: unknown, fallback: string): Promise<string> {
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json();
      if (body?.error) return body.error as string;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

// Compact slot picker for admin reschedule: fetches availability for the booking's
// service and moves the turno to the chosen slot via admin-booking.
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.functions
      .invoke("availability", { body: { service_id: serviceId } })
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

  async function pick(slot: Slot) {
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

  return (
    <div className="w-full max-w-sm">
      {days === null ? (
        <p className="text-sm text-fg-faint">Cargando horarios…</p>
      ) : days.length === 0 ? (
        <p className="text-sm text-fg-faint">No hay horarios disponibles.</p>
      ) : (
        <>
          <div className="flex flex-wrap justify-end gap-1.5">
            {days.map((d) => (
              <Button
                key={d.date}
                type="button"
                size="sm"
                variant={d.date === activeDay ? "default" : "outline"}
                onClick={() => setActiveDay(d.date)}
                className="capitalize"
              >
                {fmtDayLabel(d.date)}
              </Button>
            ))}
          </div>
          {day && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {day.slots.map((s) => (
                <Button
                  key={s.starts_at}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={submitting}
                  onClick={() => pick(s)}
                  className="font-mono tabular-nums"
                >
                  {fmtTime(s.starts_at, tz)}
                </Button>
              ))}
            </div>
          )}
        </>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
