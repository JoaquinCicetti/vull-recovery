"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WEEK_ORDER, WEEKDAY_SHORT, hm } from "@/lib/membership";
import type { SectorHours } from "@/lib/types";

// "HH:MM" open/close, cut into `slot_minutes` turnos from `opens`.
export type Range = { opens: string; closes: string; slot_minutes: number };
// weekday (0=Sun … 6=Sat) → its open ranges; an empty list = closed.
export type WeekHours = Record<number, Range[]>;

const SLOT_OPTIONS = [15, 20, 30, 45, 60, 90, 120];
const DEFAULT_SLOT = 30;

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const fromMin = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

// How many turnos a range holds and when the last one ends (it may end before
// `closes` when the range isn't a multiple of the slot).
export function rangeSlots(r: Range): { count: number; lastEnd: string } {
  const open = toMin(r.opens);
  const count = Math.max(0, Math.floor((toMin(r.closes) - open) / r.slot_minutes));
  return { count, lastEnd: fromMin(open + count * r.slot_minutes) };
}

export function toWeekHours(
  rows: Pick<SectorHours, "weekday" | "opens" | "closes" | "slot_minutes">[],
): WeekHours {
  const week: WeekHours = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const r of rows) {
    week[r.weekday].push({
      opens: hm(r.opens),
      closes: hm(r.closes),
      slot_minutes: r.slot_minutes ?? DEFAULT_SLOT,
    });
  }
  for (const d of WEEK_ORDER) week[d].sort((a, b) => a.opens.localeCompare(b.opens));
  return week;
}

export function fromWeekHours(week: WeekHours) {
  return WEEK_ORDER.flatMap((weekday) =>
    week[weekday].map((r) => ({
      weekday,
      opens: r.opens,
      closes: r.closes,
      slot_minutes: r.slot_minutes,
    })),
  );
}

// The first problem in the week, in Spanish, or null when it can be saved. The
// database enforces the same (closes > opens, no overlapping ranges).
export function weekHoursError(week: WeekHours): string | null {
  let open = 0;
  for (const d of WEEK_ORDER) {
    const ranges = [...week[d]].sort((a, b) => a.opens.localeCompare(b.opens));
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (!r.opens || !r.closes) return `Completá los horarios del ${WEEKDAY_SHORT[d]}.`;
      if (r.closes <= r.opens) {
        return `${WEEKDAY_SHORT[d]}: la hora de cierre debe ser posterior a la de apertura.`;
      }
      if (i > 0 && r.opens < ranges[i - 1].closes) {
        return `${WEEKDAY_SHORT[d]}: dos rangos se superponen.`;
      }
      if (rangeSlots(r).count === 0) {
        return `${WEEKDAY_SHORT[d]}: el rango es más corto que un turno.`;
      }
    }
    if (ranges.length) open++;
  }
  return open === 0 ? "Elegí al menos un día de atención." : null;
}

// One row per weekday (Mon → Sun): a switch to open/close it and one or more
// open ranges, each with its turno length. A new range starts where the
// previous one ends and inherits its turno length.
export function WeekdayHoursEditor({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: WeekHours;
  onChange: (next: WeekHours) => void;
}) {
  function set(day: number, ranges: Range[]) {
    onChange({ ...value, [day]: ranges });
  }
  // A newly opened day takes the turno length already used elsewhere.
  function lastSlot() {
    for (const d of WEEK_ORDER) {
      const r = value[d][value[d].length - 1];
      if (r) return r.slot_minutes;
    }
    return DEFAULT_SLOT;
  }

  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-2 text-sm text-fg-muted">Días y horarios de atención</legend>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {WEEK_ORDER.map((day) => {
          const ranges = value[day];
          const open = ranges.length > 0;
          const label = WEEKDAY_SHORT[day];
          return (
            <li key={day} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5">
              <label className="flex w-20 shrink-0 items-center gap-2 pt-1.5">
                <Switch
                  checked={open}
                  onCheckedChange={(on) =>
                    set(
                      day,
                      on ? [{ opens: "09:00", closes: "18:00", slot_minutes: lastSlot() }] : [],
                    )
                  }
                  aria-label={`${label} abierto`}
                />
                <span className={open ? "text-sm font-medium text-fg" : "text-sm text-fg-faint"}>
                  {label}
                </span>
              </label>

              {open ? (
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {ranges.map((r, i) => {
                    const { count, lastEnd } = rangeSlots(r);
                    const slots = SLOT_OPTIONS.includes(r.slot_minutes)
                      ? SLOT_OPTIONS
                      : [...SLOT_OPTIONS, r.slot_minutes].sort((a, b) => a - b);
                    return (
                      <div key={i} className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            id={`${idPrefix}-${day}-${i}-o`}
                            type="time"
                            className="w-fit font-mono"
                            value={r.opens}
                            aria-label={`${label}, rango ${i + 1}, abre`}
                            onChange={(e) =>
                              set(
                                day,
                                ranges.map((x, j) => (j === i ? { ...x, opens: e.target.value } : x)),
                              )
                            }
                          />
                          <span className="text-fg-faint" aria-hidden>
                            –
                          </span>
                          <Input
                            id={`${idPrefix}-${day}-${i}-c`}
                            type="time"
                            className="w-fit font-mono"
                            value={r.closes}
                            aria-label={`${label}, rango ${i + 1}, cierra`}
                            onChange={(e) =>
                              set(
                                day,
                                ranges.map((x, j) => (j === i ? { ...x, closes: e.target.value } : x)),
                              )
                            }
                          />
                          <Select
                            value={String(r.slot_minutes)}
                            onValueChange={(v) =>
                              set(
                                day,
                                ranges.map((x, j) =>
                                  j === i ? { ...x, slot_minutes: Number(v) } : x,
                                ),
                              )
                            }
                          >
                            <SelectTrigger
                              className="font-mono"
                              aria-label={`${label}, rango ${i + 1}, turnos de`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {slots.map((n) => (
                                <SelectItem key={n} value={String(n)}>
                                  Turnos de {n} min
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Quitar rango ${i + 1} del ${label}`}
                            onClick={() => set(day, ranges.filter((_, j) => j !== i))}
                          >
                            <X className="size-4" aria-hidden />
                          </Button>
                        </div>
                        {r.opens && r.closes && r.closes > r.opens && (
                          <p className="text-xs text-fg-faint">
                            {count === 0
                              ? "El rango es más corto que un turno."
                              : `${count} ${count === 1 ? "turno" : "turnos"}, el último termina a las ${lastEnd}.`}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-start text-fg-muted"
                    onClick={() => {
                      const last = ranges[ranges.length - 1];
                      const opens = last?.closes ?? "09:00";
                      set(day, [
                        ...ranges,
                        {
                          opens,
                          closes: opens < "21:00" ? "21:00" : "23:59",
                          slot_minutes: last?.slot_minutes ?? lastSlot(),
                        },
                      ]);
                    }}
                  >
                    <Plus className="size-3.5" aria-hidden />
                    Rango
                  </Button>
                </div>
              ) : (
                <span className="pt-1.5 text-sm text-fg-faint">Cerrado</span>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
