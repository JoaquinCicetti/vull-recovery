// deno test: the slot grid and the booking window (ADR 0012). Buenos Aires is
// UTC-3 with no DST, so local times below are UTC minus 3 h.
import { assertEquals } from "jsr:@std/assert@1";
import {
  bookingWindow,
  gridTimes,
  rangeStarts,
  type Settings,
  validateSlot,
  windowsForDate,
} from "./booking-rules.ts";

// Local wall-clock time in Buenos Aires → epoch ms.
const ba = (iso: string) => new Date(`${iso}-03:00`).getTime();
const MIN = 60000;

const recovery: Settings = {
  timezone: "America/Argentina/Buenos_Aires",
  lead_minutes: 60,
  hours: [
    // Monday: 60-min turnos in the morning, 30-min in the afternoon.
    { weekday: 1, opens: "08:00", closes: "10:00", slot_minutes: 60 },
    { weekday: 1, opens: "16:00", closes: "17:45", slot_minutes: 30 },
    { weekday: 2, opens: "16:00", closes: "20:00", slot_minutes: 30 },
    { weekday: 0, opens: "16:00", closes: "20:00", slot_minutes: 30 },
  ],
  booking_window: "week",
  rolling_days: 14,
  next_week_opens_dow: 0,
  next_week_opens_at: "14:00",
};
const pilates: Settings = { ...recovery, booking_window: "rolling" };

// 2026-10-19 is a Monday; 2026-10-25 the Sunday of that week.
Deno.test("week window on Monday: until Sunday, next week opens Sunday 14:00", () => {
  assertEquals(bookingWindow(ba("2026-10-19T10:00"), recovery), {
    fromMs: ba("2026-10-19T10:00"),
    toMs: ba("2026-10-26T00:00"),
    nextWeekOpensMs: ba("2026-10-25T14:00"),
  });
});

Deno.test("week window on Saturday: still until Sunday", () => {
  const w = bookingWindow(ba("2026-10-24T18:00"), recovery);
  assertEquals(w.toMs, ba("2026-10-26T00:00"));
  assertEquals(w.nextWeekOpensMs, ba("2026-10-25T14:00"));
});

Deno.test("week window on Sunday 13:59: next week still closed", () => {
  const w = bookingWindow(ba("2026-10-25T13:59"), recovery);
  assertEquals(w.toMs, ba("2026-10-26T00:00"));
  assertEquals(w.nextWeekOpensMs, ba("2026-10-25T14:00"));
});

Deno.test("week window on Sunday 14:00: next week open, rest of Sunday too", () => {
  const now = ba("2026-10-25T14:00");
  const w = bookingWindow(now, recovery);
  assertEquals(w, { fromMs: now, toMs: ba("2026-11-02T00:00"), nextWeekOpensMs: null });
  // Sunday 16:00 (this week) and next Tuesday are both bookable.
  assertEquals(validateSlot({ startMs: ba("2026-10-25T16:00"), settings: recovery, busy: [], now }).ok, true);
  assertEquals(validateSlot({ startMs: ba("2026-10-27T16:00"), settings: recovery, busy: [], now }).ok, true);
});

Deno.test("rolling window (pilates): the next rolling_days days", () => {
  const now = ba("2026-10-19T10:00");
  assertEquals(bookingWindow(now, pilates), {
    fromMs: now,
    toMs: now + 14 * 86400000,
    nextWeekOpensMs: null,
  });
  // Next Tuesday is fine for pilates, not for recovery before Sunday 14:00.
  const tue = ba("2026-10-27T16:00");
  assertEquals(validateSlot({ startMs: tue, settings: pilates, busy: [], now }).ok, true);
  assertEquals(validateSlot({ startMs: tue, settings: recovery, busy: [], now }), {
    ok: false,
    error: "Ese horario todavía no está habilitado para reservar.",
  });
});

Deno.test("grid: each range steps by its own slot length", () => {
  const wins = windowsForDate(2026, 10, 19, recovery);
  assertEquals(gridTimes(wins), [
    ba("2026-10-19T08:00"),
    ba("2026-10-19T09:00"),
    ba("2026-10-19T16:00"),
    ba("2026-10-19T16:30"),
    ba("2026-10-19T17:00"),
    // 17:30 would end 18:00, past the 17:45 close.
  ]);
  assertEquals(rangeStarts(recovery.hours[1]), [16 * 60, 16 * 60 + 30, 17 * 60]);
  // A 60-min abono class on the 30-min grid must still fit before close.
  assertEquals(rangeStarts(recovery.hours[1], 60), [16 * 60, 16 * 60 + 30]);
});

Deno.test("validateSlot: a turno ends one slot later", () => {
  const now = ba("2026-10-19T06:00");
  const am = validateSlot({ startMs: ba("2026-10-19T08:00"), settings: recovery, busy: [], now });
  assertEquals(am, { ok: true, endMs: ba("2026-10-19T09:00") });
  const pm = validateSlot({ startMs: ba("2026-10-19T16:30"), settings: recovery, busy: [], now });
  assertEquals(pm, { ok: true, endMs: ba("2026-10-19T17:00") });
  // An abono class keeps its own length.
  const cls = validateSlot({
    startMs: ba("2026-10-19T16:30"),
    settings: recovery,
    busy: [],
    now,
    lengthMs: 60 * MIN,
  });
  assertEquals(cls, { ok: true, endMs: ba("2026-10-19T17:30") });
});

Deno.test("validateSlot rejections", () => {
  const now = ba("2026-10-19T06:00");
  const check = (iso: string, extra: Partial<Parameters<typeof validateSlot>[0]> = {}) =>
    validateSlot({ startMs: ba(iso), settings: recovery, busy: [], now, ...extra });

  assertEquals(check("2026-10-19T16:15"), { ok: false, error: "Ese horario no está disponible." });
  assertEquals(check("2026-10-19T08:30"), { ok: false, error: "Ese horario no está disponible." });
  // Past the close: 17:30 + 30 min > 17:45.
  assertEquals(check("2026-10-19T17:30"), {
    ok: false,
    error: "Ese horario está fuera del horario de atención.",
  });
  // Between ranges.
  assertEquals(check("2026-10-19T12:00"), {
    ok: false,
    error: "Ese horario está fuera del horario de atención.",
  });
  // A 60-min class at 17:00 doesn't fit before 17:45.
  assertEquals(check("2026-10-19T17:00", { lengthMs: 60 * MIN }), {
    ok: false,
    error: "Ese horario está fuera del horario de atención.",
  });
  // Closed weekday (Wednesday).
  assertEquals(check("2026-10-21T16:00"), {
    ok: false,
    error: "Ese día no está disponible para reservar.",
  });
  // Lead time.
  assertEquals(check("2026-10-19T08:00", { now: ba("2026-10-19T07:30") }), {
    ok: false,
    error: "Necesitás reservar con al menos una hora de anticipación.",
  });
  // Out of the week window, unless the window isn't enforced (admins).
  assertEquals(check("2026-10-27T16:00"), {
    ok: false,
    error: "Ese horario todavía no está habilitado para reservar.",
  });
  assertEquals(check("2026-10-27T16:00", { enforceWindow: false }), {
    ok: true,
    endMs: ba("2026-10-27T16:30"),
  });
  // Grid alignment is enforced even without the window.
  assertEquals(check("2026-10-27T16:10", { enforceWindow: false }).ok, false);
  // Google busy over the slot.
  assertEquals(
    check("2026-10-19T16:00", {
      busy: [{ start: ba("2026-10-19T16:20"), end: ba("2026-10-19T16:40") }],
    }),
    { ok: false, error: "Ese horario ya no está disponible. Elegí otro." },
  );
});
