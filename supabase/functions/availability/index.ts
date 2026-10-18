// Public Edge Function: returns open slots for a service inside the sector's
// booking window (the current Mon–Sun week for recovery, the next 14 days for
// pilates; see bookingWindow). Open slot = on the admin's slot grid of one of
// the sector's open ranges for that weekday, not in the past, not within the
// lead window, not overlapping a Google Calendar busy block, and with at least
// one of the sector's resources (beds) free for the whole slot. Slot legality is decided by the shared
// validateSlot() so this function and create-booking can never disagree; which
// bed a turno gets is decided by the DB on insert.
//
// Monthly plans (abonos) are not booked slot by slot (their weekly picker uses
// membership-availability), but their members move single classes into these
// free slots, so a monthly plan is answered too; create-booking refuses it.
//
// `scope: "admin"` (admins only) ignores the client window, for rescheduling:
// it shows the next `rolling_days` days, or the client window if that is longer.
import { adminClient, userClient } from "../_shared/supabase.ts";
import { responder, errMessage } from "../_shared/cors.ts";
import { getBusy } from "../_shared/google.ts";
import { housekeeping } from "../_shared/membership.ts";
import { localYMD } from "../_shared/time.ts";
import {
  type Busy,
  bookingWindow,
  gridTimes,
  validateSlot,
  windowsForDate,
} from "../_shared/booking-rules.ts";
import {
  canUseSector,
  isAdminUser,
  loadServiceWithSector,
  sectorCalendarId,
  sectorSettings,
} from "../_shared/sector.ts";

const ACTIVE = ["pending", "awaiting_payment", "confirmed"];

type OutSlot = {
  starts_at: string;
  ends_at: string;
  // The beds free at that time, in bed order. Booking a single turno doesn't
  // need it (the DB assigns the first free bed); moving an abono class lets the
  // member keep or choose a bed.
  free_resources: { id: string; name: string }[];
};

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
  try {
    const { service_id, scope } = await req.json();
    if (!service_id) return json({ error: "service_id requerido" }, 400);

    const supabase = adminClient();

    // Lazy maintenance (no cron needed): free lapsed holds, expire lapsed abono
    // signups and keep recurring members' next month materialized, so the
    // bookings read below sees every bed that is really taken.
    const [, service] = await Promise.all([
      housekeeping(supabase),
      loadServiceWithSector(supabase, service_id),
    ]);
    if (!service || !service.active) {
      return json({ error: "Servicio no disponible" }, 404);
    }
    const sector = service.sectors;
    // The caller is only looked up when it matters (hidden sector, admin scope).
    const user = !sector.active || scope === "admin"
      ? (await userClient(req).auth.getUser()).data.user
      : null;
    if (!sector.active && !(await canUseSector(supabase, sector, user))) {
      return json({ error: "Servicio no disponible" }, 404);
    }
    const asAdmin = scope === "admin" && (await isAdminUser(supabase, user));

    const settings = sectorSettings(sector);
    const tz = settings.timezone;

    const now = Date.now();
    const window = bookingWindow(now, settings);
    const rangeEnd = asAdmin
      ? Math.max(window.toMs, now + settings.rolling_days * 86400000)
      : window.toMs;
    // The last slot may run past rangeEnd: read busy blocks a day further.
    const readEnd = new Date(rangeEnd + 86400000).toISOString();

    const [googleBusy, { data: resources }, { data: bookings }] = await Promise.all([
      getBusy(
        new Date(now).toISOString(),
        readEnd,
        sectorCalendarId(sector),
      ).catch(() => []),
      supabase
        .from("resources")
        .select("id, name")
        .eq("sector_id", sector.id)
        .eq("active", true)
        .order("sort_order")
        .order("created_at"),
      supabase
        .from("bookings")
        .select("resource_id,starts_at,ends_at")
        .eq("sector_id", sector.id)
        .in("status", ACTIVE)
        .lt("starts_at", readEnd)
        .gt("ends_at", new Date(now).toISOString()),
    ]);

    // Google busy blocks the whole sector; a turno blocks only its resource.
    const busy: Busy[] = googleBusy.map((b) => ({
      start: new Date(b.start).getTime(),
      end: new Date(b.end).getTime(),
    }));
    const taken = new Map<string, Busy[]>();
    for (const b of bookings ?? []) {
      const list = taken.get(b.resource_id) ?? [];
      list.push({ start: new Date(b.starts_at).getTime(), end: new Date(b.ends_at).getTime() });
      taken.set(b.resource_id, list);
    }
    const beds = (resources ?? []) as { id: string; name: string }[];
    const freeResources = (start: number, end: number) =>
      beds.filter(
        (r) => !(taken.get(r.id) ?? []).some((b) => start < b.end && end > b.start),
      );

    // Every local date from today to the one the window ends in.
    const today = localYMD(tz, new Date(now));
    const last = localYMD(tz, new Date(rangeEnd - 1));
    const base = Date.UTC(today.y, today.m - 1, today.d);
    const lastBase = Date.UTC(last.y, last.m - 1, last.d);
    const days: { date: string; slots: OutSlot[] }[] = [];

    for (let t = base; t <= lastBase; t += 86400000) {
      const dd = new Date(t);
      const y = dd.getUTCFullYear();
      const m = dd.getUTCMonth() + 1;
      const d = dd.getUTCDate();
      const windows = windowsForDate(y, m, d, settings);
      if (windows.length === 0) continue;

      const slots: OutSlot[] = [];
      for (const s of gridTimes(windows)) {
        if (s >= rangeEnd) continue;
        const check = validateSlot({ startMs: s, settings, busy, now, enforceWindow: !asAdmin });
        if (!check.ok) continue;
        const free = freeResources(s, check.endMs);
        if (free.length === 0) continue;
        slots.push({
          starts_at: new Date(s).toISOString(),
          ends_at: new Date(check.endMs).toISOString(),
          free_resources: free,
        });
      }

      if (slots.length) {
        days.push({
          date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
          slots,
        });
      }
    }

    return json({
      service_id,
      // Information for the client only: the turno is one slot of the grid.
      duration_minutes: service.duration_minutes,
      timezone: tz,
      // The client window (also under scope "admin", for the hint).
      window: {
        kind: settings.booking_window,
        from: new Date(window.fromMs).toISOString(),
        to: new Date(window.toMs).toISOString(),
        next_week_opens_at: window.nextWeekOpensMs === null
          ? null
          : new Date(window.nextWeekOpensMs).toISOString(),
      },
      days,
    });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
