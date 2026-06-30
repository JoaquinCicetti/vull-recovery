// Public Edge Function: returns open slots for a service over the next N days.
// Open slot = inside working hours, not in the past, not within the lead window,
// grid-aligned, and not overlapping any Google Calendar busy block or active
// booking. Slot legality is decided by the shared validateSlot() so this function
// and create-booking can never disagree.
import { adminClient } from "../_shared/supabase.ts";
import { responder, errMessage } from "../_shared/cors.ts";
import { getBusy } from "../_shared/google.ts";
import { localYMD, parseHM, zonedToUtc } from "../_shared/time.ts";
import {
  DAYS_AHEAD,
  type Busy,
  type Settings,
  validateSlot,
} from "../_shared/booking-rules.ts";

const ACTIVE = ["pending", "awaiting_payment", "confirmed"];

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
  try {
    const { service_id } = await req.json();
    if (!service_id) return json({ error: "service_id requerido" }, 400);

    const supabase = adminClient();

    // Free up expired holds so their slots become bookable again (no cron needed).
    await supabase
      .from("bookings")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("hold_expires_at", new Date().toISOString());

    const [{ data: service }, { data: row }] = await Promise.all([
      supabase
        .from("services")
        .select("id,duration_minutes,active")
        .eq("id", service_id)
        .single(),
      supabase.from("settings").select("*").eq("id", true).single(),
    ]);

    if (!service || !service.active) {
      return json({ error: "Servicio no disponible" }, 404);
    }

    const settings: Settings = {
      working_hours_start: row?.working_hours_start ?? "09:00",
      working_hours_end: row?.working_hours_end ?? "18:00",
      working_days: row?.working_days ?? [1, 2, 3, 4, 5],
      timezone: row?.timezone ?? "America/Argentina/Buenos_Aires",
    };
    const tz = settings.timezone;
    const open = parseHM(settings.working_hours_start);
    const close = parseHM(settings.working_hours_end);
    const durationMs = service.duration_minutes * 60000;

    const now = Date.now();
    const rangeEnd = now + DAYS_AHEAD * 86400000;

    const [googleBusy, { data: bookings }] = await Promise.all([
      getBusy(new Date(now).toISOString(), new Date(rangeEnd).toISOString()).catch(
        () => [],
      ),
      supabase
        .from("bookings")
        .select("starts_at,ends_at")
        .in("status", ACTIVE)
        .lt("starts_at", new Date(rangeEnd).toISOString())
        .gt("ends_at", new Date(now).toISOString()),
    ]);

    const busy: Busy[] = [
      ...googleBusy.map((b) => ({
        start: new Date(b.start).getTime(),
        end: new Date(b.end).getTime(),
      })),
      ...(bookings ?? []).map((b) => ({
        start: new Date(b.starts_at).getTime(),
        end: new Date(b.ends_at).getTime(),
      })),
    ];

    const today = localYMD(tz, new Date(now));
    const base = Date.UTC(today.y, today.m - 1, today.d);
    const days: { date: string; slots: { starts_at: string; ends_at: string }[] }[] = [];

    for (let i = 0; i < DAYS_AHEAD; i++) {
      const dd = new Date(base + i * 86400000);
      const y = dd.getUTCFullYear();
      const m = dd.getUTCMonth() + 1;
      const d = dd.getUTCDate();
      if (!settings.working_days.includes(dd.getUTCDay())) continue;

      const dayOpen = zonedToUtc(y, m, d, open.h, open.m, tz).getTime();
      const dayClose = zonedToUtc(y, m, d, close.h, close.m, tz).getTime();

      const slots: { starts_at: string; ends_at: string }[] = [];
      for (let s = dayOpen; s + durationMs <= dayClose; s += durationMs) {
        if (!validateSlot({ startMs: s, durationMs, settings, busy, now }).ok) {
          continue;
        }
        slots.push({
          starts_at: new Date(s).toISOString(),
          ends_at: new Date(s + durationMs).toISOString(),
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
