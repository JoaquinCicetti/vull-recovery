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

export const LEAD_MINUTES = 60; // earliest bookable time from now
export const DAYS_AHEAD = 14;

export type Settings = {
  working_hours_start: string;
  working_hours_end: string;
  working_days: number[];
  timezone: string;
};

export type Busy = { start: number; end: number }; // epoch ms

// Working-window bounds (epoch ms) for the local day `startMs` falls on, or null
// when that local day is not a working day.
export function workingWindow(
  startMs: number,
  settings: Settings,
): { open: number; close: number } | null {
  const tz = settings.timezone;
  const { y, m, d } = localYMD(tz, new Date(startMs));
  // Weekday of the local date (0=Sun..6=Sat), matching availability's loop.
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (!settings.working_days.includes(weekday)) return null;
  const open = parseHM(settings.working_hours_start);
  const close = parseHM(settings.working_hours_end);
  return {
    open: zonedToUtc(y, m, d, open.h, open.m, tz).getTime(),
    close: zonedToUtc(y, m, d, close.h, close.m, tz).getTime(),
  };
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

  if (startMs < now + LEAD_MINUTES * 60000) {
    return {
      ok: false,
      error: "Necesitás reservar con al menos una hora de anticipación.",
    };
  }
  const win = workingWindow(startMs, settings);
  if (!win) {
    return { ok: false, error: "Ese día no está disponible para reservar." };
  }
  if (startMs < win.open || endMs > win.close) {
    return { ok: false, error: "Ese horario está fuera del horario de atención." };
  }
  // Slots step by `durationMs` from the day's opening time.
  if ((startMs - win.open) % durationMs !== 0) {
    return { ok: false, error: "Ese horario no está disponible." };
  }
  if (busy.some((b) => startMs < b.end && endMs > b.start)) {
    return { ok: false, error: "Ese horario ya no está disponible. Elegí otro." };
  }
  return { ok: true };
}
