// Single source of truth for slot legality. Used by BOTH `availability` (to
// generate open slots) and `create-booking` (to re-validate the client-supplied
// time before inserting) so the two can never drift.
//
// The DB EXCLUDE constraint (bookings_no_overlap) remains the race-safe arbiter
// for booking-vs-booking overlap; these rules cover the parts the DB cannot know
// about: working hours/days, lead time, slot-grid alignment, the booking window,
// and Google freeBusy overlap. The Google-overlap guard is BEST-EFFORT (skipped
// when freeBusy is unavailable) — see docs/booking-invariants.md.
//
// The grid is the admin's, not the plan's: each open range carries its own
// `slot_minutes` and a turno occupies exactly one slot (ADR 0012). A plan's
// duration_minutes is information for the client only, except for abono
// classes, which keep their plan's length (`lengthMs`).
import { localYMD, parseHM, zonedToUtc } from "./time.ts";

const DAY_MS = 86400000;

// A sector's agenda (see _shared/sector.ts). `hours` are the open ranges of
// each weekday (0=Sun..6=Sat, several per day allowed, a weekday with none is
// closed), each cut into `slot_minutes` turnos from its `opens`; `lead_minutes`
// is the earliest bookable time from now.
export type OpenRange = {
  weekday: number;
  opens: string;
  closes: string;
  slot_minutes: number;
};

export type Settings = {
  timezone: string;
  lead_minutes: number;
  hours: OpenRange[];
  // How far ahead clients may book. 'rolling': the next `rolling_days` days.
  // 'week': the current Mon–Sun week only; the next one opens on
  // `next_week_opens_dow` (0=Sun..6=Sat, inside the current week) at
  // `next_week_opens_at` local time ("HH:MM").
  booking_window: "rolling" | "week";
  rolling_days: number;
  next_week_opens_dow: number;
  next_week_opens_at: string;
};

export type Busy = { start: number; end: number }; // epoch ms

// One open range of one date (epoch ms) and the length of its slots.
export type Window = { open: number; close: number; slotMs: number };

// Weekday (0=Sun..6=Sat) of a local calendar date.
export function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// The open windows (epoch ms, sorted) of one local calendar date. Empty when the
// sector is closed that weekday.
//
// Hours are ONE recurring weekly template. Per-date overrides (a holiday, a
// different week) would go here and nowhere else: everything that asks "is it
// open then" goes through this function.
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
        slotMs: h.slot_minutes * 60000,
      };
    })
    .sort((a, b) => a.open - b.open);
}

// The open windows of the local day `startMs` falls on.
export function workingWindows(startMs: number, settings: Settings): Window[] {
  const { y, m, d } = localYMD(settings.timezone, new Date(startMs));
  return windowsForDate(y, m, d, settings);
}

// Grid start instants inside the windows: every slot steps by its window's
// slot length from the window's opening time and must end by its close.
export function gridTimes(windows: Window[]): number[] {
  const out: number[] = [];
  for (const w of windows) {
    for (let s = w.open; s + w.slotMs <= w.close; s += w.slotMs) out.push(s);
  }
  return out;
}

// The same grid as minutes of the day, for pickers that work per weekday
// rather than per date (membership-availability). A start is offered only if
// `lengthMin` (default: one slot) also fits before the range closes.
export function rangeStarts(range: OpenRange, lengthMin = range.slot_minutes): number[] {
  const o = parseHM(range.opens);
  const c = parseHM(range.closes);
  const close = c.h * 60 + c.m;
  const fit = Math.max(range.slot_minutes, lengthMin);
  const out: number[] = [];
  for (let min = o.h * 60 + o.m; min + fit <= close; min += range.slot_minutes) out.push(min);
  return out;
}

export type BookingWindow = {
  fromMs: number;
  // Exclusive: a turno must START before this instant.
  toMs: number;
  // When the following week becomes bookable, or null when it already is (and
  // always for a rolling window).
  nextWeekOpensMs: number | null;
};

// What clients may book at `nowMs`. A 'week' sector shows the current Mon–Sun
// week; from the opening instant (Sunday 14:00 by default) it shows the next
// week too, and what is left of the current one stays bookable.
export function bookingWindow(nowMs: number, settings: Settings): BookingWindow {
  if (settings.booking_window !== "week") {
    return { fromMs: nowMs, toMs: nowMs + settings.rolling_days * DAY_MS, nextWeekOpensMs: null };
  }
  const tz = settings.timezone;
  const t = localYMD(tz, new Date(nowMs));
  // Monday of this week, as a UTC-midnight date (calendar arithmetic only).
  const monday = Date.UTC(t.y, t.m - 1, t.d) - ((weekdayOf(t.y, t.m, t.d) + 6) % 7) * DAY_MS;
  const at = (days: number, hm: string) => {
    const d = new Date(monday + days * DAY_MS);
    const { h, m } = parseHM(hm);
    return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, m, tz).getTime();
  };
  const opens = at((settings.next_week_opens_dow + 6) % 7, settings.next_week_opens_at);
  if (nowMs >= opens) return { fromMs: nowMs, toMs: at(14, "00:00"), nextWeekOpensMs: null };
  return { fromMs: nowMs, toMs: at(7, "00:00"), nextWeekOpensMs: opens };
}

function leadError(minutes: number): string {
  if (minutes === 60) return "Necesitás reservar con al menos una hora de anticipación.";
  if (minutes % 60 === 0) {
    return `Necesitás reservar con al menos ${minutes / 60} horas de anticipación.`;
  }
  return `Necesitás reservar con al menos ${minutes} minutos de anticipación.`;
}

export type SlotCheck = { ok: true; endMs: number } | { ok: false; error: string };

// Validate a single candidate slot and return when the turno ends (one slot
// later). `busy` should include any Google freeBusy blocks (and may include DB
// bookings). `lengthMs` overrides the occupied length (abono classes keep their
// plan's duration); it must fit in the range as well as the slot.
// `enforceWindow: false` skips the booking window: admins and abono schedules
// may land beyond what a client can book, never off the grid.
export function validateSlot(opts: {
  startMs: number;
  settings: Settings;
  busy: Busy[];
  now?: number;
  lengthMs?: number;
  enforceWindow?: boolean;
}): SlotCheck {
  const { startMs, settings, busy } = opts;
  const now = opts.now ?? Date.now();

  if (startMs < now + settings.lead_minutes * 60000) {
    return { ok: false, error: leadError(settings.lead_minutes) };
  }
  const wins = workingWindows(startMs, settings);
  if (wins.length === 0) {
    return { ok: false, error: "Ese día no está disponible para reservar." };
  }
  const win = wins.find((w) => startMs >= w.open && startMs < w.close);
  const endMs = startMs + (opts.lengthMs ?? win?.slotMs ?? 0);
  if (!win || Math.max(startMs + win.slotMs, endMs) > win.close) {
    return { ok: false, error: "Ese horario está fuera del horario de atención." };
  }
  // Slots step by the range's slot length from its opening time.
  if ((startMs - win.open) % win.slotMs !== 0) {
    return { ok: false, error: "Ese horario no está disponible." };
  }
  if ((opts.enforceWindow ?? true) && startMs >= bookingWindow(now, settings).toMs) {
    return { ok: false, error: "Ese horario todavía no está habilitado para reservar." };
  }
  if (busy.some((b) => startMs < b.end && endMs > b.start)) {
    return { ok: false, error: "Ese horario ya no está disponible. Elegí otro." };
  }
  return { ok: true, endMs };
}
