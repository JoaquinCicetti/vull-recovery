"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Settings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
    <Card className="surface-lift animate-fade-up [--card-spacing:--spacing(5)]">
      <CardContent>
        <form onSubmit={save}>
          <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
            Ventana de atención
          </h2>

          <div className="mt-4 flex flex-col gap-5">
            <div className="flex flex-wrap gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="hours-start" className="text-fg-muted">
                  Abre
                </Label>
                <Input
                  id="hours-start"
                  type="time"
                  className="w-fit font-mono"
                  value={start}
                  onChange={(e) => {
                    setSaved(false);
                    setStart(e.target.value);
                  }}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="hours-end" className="text-fg-muted">
                  Cierra
                </Label>
                <Input
                  id="hours-end"
                  type="time"
                  className="w-fit font-mono"
                  value={end}
                  onChange={(e) => {
                    setSaved(false);
                    setEnd(e.target.value);
                  }}
                  required
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm text-fg-muted">Días de atención</span>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d) => {
                  const on = days.includes(d.value);
                  return (
                    <Button
                      key={d.value}
                      type="button"
                      variant={on ? "default" : "outline"}
                      onClick={() => toggleDay(d.value)}
                      aria-pressed={on}
                      className={on ? undefined : "font-normal text-fg-muted"}
                    >
                      {d.label}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-fg-muted">Zona horaria</Label>
              <Select
                value={tz}
                onValueChange={(value) => {
                  setSaved(false);
                  setTz(value);
                }}
              >
                <SelectTrigger className="w-full sm:w-fit">
                  <SelectValue placeholder="Zona horaria" />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((z) => (
                    <SelectItem key={z} value={z}>
                      {z}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3">
              <Button className="self-start" disabled={busy}>
                {busy ? "Guardando…" : "Guardar"}
              </Button>
              {saved && <span className="text-sm text-accent">Guardado ✓</span>}
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
