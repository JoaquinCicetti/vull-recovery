// Single source of truth for slot legality. Used by BOTH `availability` (to
// generate open slots) and `create-booking` (to re-validate the client-supplied
// time before inserting) so the two can never drift.
//
// The DB EXCLUDE constraint (bookings_no_overlap) remains the race-safe arbiter
// for booking-vs-booking overlap; these rules cover the parts the DB cannot know
// about: working hours/days, lead time, slot-grid alignment, and Google freeBusy
// overlap. The Google-overlap guard is BEST-EFFORT (skipped when freeBusy is
// unavailable) — see docs/booking-invariants.md.
import { localYMD, parseHM, zonedToUtc } from "./time.ts";

export const DAYS_AHEAD = 14;

// A sector's agenda (see _shared/sector.ts). `hours` are the open ranges of
// each weekday (0=Sun..6=Sat, several per day allowed, a weekday with none is
// closed); `lead_minutes` is the earliest bookable time from now.
export type OpenRange = { weekday: number; opens: string; closes: string };

export type Settings = {
  timezone: string;
  lead_minutes: number;
  hours: OpenRange[];
};

export type Busy = { start: number; end: number }; // epoch ms

export type Window = { open: number; close: number }; // epoch ms

// Weekday (0=Sun..6=Sat) of a local calendar date.
export function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// The open windows (epoch ms, sorted) of one local calendar date. Empty when the
// sector is closed that weekday.
export function windowsForDate(
  y: number,
  m: number,
  d: number,
  settings: Settings,
): Window[] {
  const tz = settings.timezone;
  const weekday = weekdayOf(y, m, d);
  return settings.hours
    .filter((h) => h.weekday === weekday)
    .map((h) => {
      const o = parseHM(h.opens);
      const c = parseHM(h.closes);
      return {
        open: zonedToUtc(y, m, d, o.h, o.m, tz).getTime(),
        close: zonedToUtc(y, m, d, c.h, c.m, tz).getTime(),
      };
    })
    .sort((a, b) => a.open - b.open);
}

// The open windows of the local day `startMs` falls on.
export function workingWindows(startMs: number, settings: Settings): Window[] {
  const { y, m, d } = localYMD(settings.timezone, new Date(startMs));
  return windowsForDate(y, m, d, settings);
}

// Grid start instants inside the windows: every slot steps by the plan's
// duration from its window's opening time and must end by its close.
export function gridTimes(windows: Window[], durationMs: number): number[] {
  const out: number[] = [];
  for (const w of windows) {
    for (let s = w.open; s + durationMs <= w.close; s += durationMs) out.push(s);
  }
  return out;
}

function leadError(minutes: number): string {
  if (minutes === 60) return "Necesitás reservar con al menos una hora de anticipación.";
  if (minutes % 60 === 0) {
    return `Necesitás reservar con al menos ${minutes / 60} horas de anticipación.`;
  }
  return `Necesitás reservar con al menos ${minutes} minutos de anticipación.`;
}

export type SlotCheck = { ok: true } | { ok: false; error: string };

// Validate a single candidate slot. `busy` should include any Google freeBusy
// blocks (and may include DB bookings) for [startMs, endMs).
export function validateSlot(opts: {
  startMs: number;
  durationMs: number;
  settings: Settings;
  busy: Busy[];
  now?: number;
}): SlotCheck {
  const { startMs, durationMs, settings, busy } = opts;
  const now = opts.now ?? Date.now();
  const endMs = startMs + durationMs;

  if (startMs < now + settings.lead_minutes * 60000) {
    return { ok: false, error: leadError(settings.lead_minutes) };
  }
  const wins = workingWindows(startMs, settings);
  if (wins.length === 0) {
    return { ok: false, error: "Ese día no está disponible para reservar." };
  }
  const win = wins.find((w) => startMs >= w.open && endMs <= w.close);
  if (!win) {
    return { ok: false, error: "Ese horario está fuera del horario de atención." };
  }
  // Slots step by `durationMs` from the opening time of their window.
  if ((startMs - win.open) % durationMs !== 0) {
    return { ok: false, error: "Ese horario no está disponible." };
  }
  if (busy.some((b) => startMs < b.end && endMs > b.start)) {
    return { ok: false, error: "Ese horario ya no está disponible. Elegí otro." };
  }
  return { ok: true };
}
