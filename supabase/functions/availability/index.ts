// Public Edge Function: returns open slots for a service over the next N days.
// Open slot = inside one of the sector's open ranges for that weekday, not in
// the past, not within the lead window, grid-aligned to its range, not
// overlapping a Google Calendar busy block, and with at least one of the
// sector's resources (beds) free. Slot legality is decided by the shared
// validateSlot() so this function and create-booking can never disagree; which
// bed a turno gets is decided by the DB on insert.
//
// Monthly plans (abonos) are not booked slot by slot (their weekly picker uses
// membership-availability), but their members move single classes into these
// free slots, so a monthly plan is answered too; create-booking refuses it.
import { adminClient, userClient } from "../_shared/supabase.ts";
import { responder, errMessage } from "../_shared/cors.ts";
import { getBusy } from "../_shared/google.ts";
import { housekeeping } from "../_shared/membership.ts";
import { localYMD } from "../_shared/time.ts";
import {
  DAYS_AHEAD,
  type Busy,
  gridTimes,
  validateSlot,
  windowsForDate,
} from "../_shared/booking-rules.ts";
import {
  canUseSector,
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
    const { service_id } = await req.json();
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
    if (!sector.active) {
      const { data: { user } } = await userClient(req).auth.getUser();
      if (!(await canUseSector(supabase, sector, user))) {
        return json({ error: "Servicio no disponible" }, 404);
      }
    }

    const settings = sectorSettings(sector);
    const tz = settings.timezone;
    const durationMs = service.duration_minutes * 60000;

    const now = Date.now();
    const rangeEnd = now + DAYS_AHEAD * 86400000;

    const [googleBusy, { data: resources }, { data: bookings }] = await Promise.all([
      getBusy(
        new Date(now).toISOString(),
        new Date(rangeEnd).toISOString(),
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
        .lt("starts_at", new Date(rangeEnd).toISOString())
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

    const today = localYMD(tz, new Date(now));
    const base = Date.UTC(today.y, today.m - 1, today.d);
    const days: { date: string; slots: OutSlot[] }[] = [];

    for (let i = 0; i < DAYS_AHEAD; i++) {
      const dd = new Date(base + i * 86400000);
      const y = dd.getUTCFullYear();
      const m = dd.getUTCMonth() + 1;
      const d = dd.getUTCDate();
      const windows = windowsForDate(y, m, d, settings);
      if (windows.length === 0) continue;

      const slots: OutSlot[] = [];
      for (const s of gridTimes(windows, durationMs)) {
        if (!validateSlot({ startMs: s, durationMs, settings, busy, now }).ok) {
          continue;
        }
        const free = freeResources(s, s + durationMs);
        if (free.length === 0) continue;
        slots.push({
          starts_at: new Date(s).toISOString(),
          ends_at: new Date(s + durationMs).toISOString(),
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
      duration_minutes: service.duration_minutes,
      timezone: tz,
      days,
    });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
