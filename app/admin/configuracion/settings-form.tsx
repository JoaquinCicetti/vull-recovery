"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Settings } from "@/lib/types";

// Weekdays in display order (Mon→Sun), mapped to JS getUTCDay() numbers
// (0=Sun … 6=Sat) — the same convention the availability function uses.
const DAYS: { value: number; label: string }[] = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mié" },
  { value: 4, label: "Jue" },
  { value: 5, label: "Vie" },
  { value: 6, label: "Sáb" },
  { value: 0, label: "Dom" },
];

const TIMEZONES = [
  "America/Argentina/Buenos_Aires",
  "America/Argentina/Cordoba",
  "America/Argentina/Mendoza",
  "America/Argentina/Salta",
  "America/Argentina/Tucuman",
];

// "09:00:00" → "09:00" for <input type="time">
const toHM = (t: string) => t.slice(0, 5);

export function SettingsForm({ initial }: { initial: Settings }) {
  const router = useRouter();
  const supabase = createClient();
  const [start, setStart] = useState(toHM(initial.working_hours_start));
  const [end, setEnd] = useState(toHM(initial.working_hours_end));
  const [days, setDays] = useState<number[]>(initial.working_days ?? []);
  const [tz, setTz] = useState(initial.timezone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggleDay(value: number) {
    setSaved(false);
    setDays((d) =>
      d.includes(value) ? d.filter((x) => x !== value) : [...d, value],
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (end <= start) {
      setError("La hora de cierre debe ser posterior a la de apertura.");
      return;
    }
    if (days.length === 0) {
      setError("Elegí al menos un día de atención.");
      return;
    }

    setBusy(true);
    const { error } = await supabase
      .from("settings")
      .update({
        working_hours_start: start,
        working_hours_end: end,
        working_days: [...days].sort((a, b) => a - b),
        timezone: tz,
      })
      .eq("id", true);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="mt-8 surface-card p-5">
      <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
        Ventana de atención
      </h2>

      <div className="mt-4 flex flex-col gap-5">
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1.5 text-sm text-fg-muted">
            Abre
            <input
              type="time"
              className="field font-mono"
              value={start}
              onChange={(e) => {
                setSaved(false);
                setStart(e.target.value);
              }}
              required
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-fg-muted">
            Cierra
            <input
              type="time"
              className="field font-mono"
              value={end}
              onChange={(e) => {
                setSaved(false);
                setEnd(e.target.value);
              }}
              required
            />
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm text-fg-muted">Días de atención</span>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => {
              const on = days.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  aria-pressed={on}
                  className={
                    on
                      ? "rounded-md border border-accent bg-accent px-3 py-2 text-sm font-semibold text-on-accent transition"
                      : "rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg-muted transition hover:border-border-strong"
                  }
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex flex-col gap-1.5 text-sm text-fg-muted">
          Zona horaria
          <select
            className="field"
            value={tz}
            onChange={(e) => {
              setSaved(false);
              setTz(e.target.value);
            }}
          >
            {TIMEZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-3">
          <button className="btn-primary self-start" disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
          {saved && <span className="text-sm text-accent">Guardado ✓</span>}
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </form>
  );
}
