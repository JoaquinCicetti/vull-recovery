"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtTime, fmtDayLabel, DEFAULT_TZ } from "@/lib/format";
import type { Service, Slot } from "@/lib/types";

type Day = { date: string; slots: Slot[] };
type AvailabilityResponse = { days?: Day[]; timezone?: string };

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
  const [selected, setSelected] = useState<Slot | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function apply(data: AvailabilityResponse) {
    const ds: Day[] = data.days ?? [];
    setDays(ds);
    setTz(data.timezone ?? DEFAULT_TZ);
    setActiveDay(ds[0]?.date ?? null);
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

  return (
    <div className="mt-10">
      <p className="eyebrow">Elegí un horario</p>

      {loading && (
        <div
          className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4"
          aria-hidden="true"
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-[42px] rounded-md bg-surface-2" />
          ))}
        </div>
      )}

      {!loading && days && days.length === 0 && (
        <p className="mt-4 text-sm text-fg-faint">
          No hay horarios disponibles por ahora. Probá más tarde.
        </p>
      )}

      {!loading && days && days.length > 0 && (
        <>
          {/* Day selector */}
          <div className="mt-4 flex animate-fade-in gap-2 overflow-x-auto pb-2">
            {days.map((d) => {
              const active = d.date === activeDay;
              return (
                <button
                  key={d.date}
                  onClick={() => {
                    setActiveDay(d.date);
                    setSelected(null);
                  }}
                  className={`shrink-0 rounded-md border px-4 py-2 text-sm capitalize transition duration-150 active:scale-[0.97] ${
                    active
                      ? "border-accent bg-accent text-on-accent"
                      : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
                  }`}
                >
                  {fmtDayLabel(d.date)}
                </button>
              );
            })}
          </div>

          {/* Slots */}
          <div className="mt-4 grid animate-fade-in grid-cols-3 gap-2 sm:grid-cols-4">
            {day?.slots.map((slot) => {
              const isSel = selected?.starts_at === slot.starts_at;
              return (
                <button
                  key={slot.starts_at}
                  onClick={() => setSelected(slot)}
                  className={`rounded-md border px-3 py-2.5 font-mono text-sm transition duration-150 active:scale-[0.97] ${
                    isSel
                      ? "border-accent bg-accent text-on-accent"
                      : "border-border bg-surface text-fg hover:border-border-strong"
                  }`}
                >
                  {fmtTime(slot.starts_at, tz)}
                </button>
              );
            })}
          </div>

          <button
            onClick={confirm}
            disabled={!selected || submitting}
            className="btn-primary mt-8 w-full py-3"
          >
            {submitting
              ? "Reservando…"
              : isAuthed
                ? "Reservar este horario"
                : "Ingresar y reservar"}
          </button>
        </>
      )}

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
    </div>
  );
}
