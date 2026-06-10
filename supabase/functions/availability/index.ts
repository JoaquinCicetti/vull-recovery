// Public Edge Function: returns open slots for a service over the next N days.
// Open slot = inside working hours, not in the past, and not overlapping any
// Google Calendar busy block or any active booking.
import { adminClient } from "../_shared/supabase.ts";
import { json, handleOptions, errMessage } from "../_shared/cors.ts";
import { getBusy } from "../_shared/google.ts";
import { zonedToUtc, localYMD, parseHM } from "../_shared/time.ts";

const DAYS_AHEAD = 14;
const LEAD_MINUTES = 60; // earliest bookable time from now

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions();
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

    const [{ data: service }, { data: settings }] = await Promise.all([
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

    const tz: string = settings?.timezone ?? "America/Argentina/Buenos_Aires";
    const open = parseHM(settings?.working_hours_start ?? "09:00");
    const close = parseHM(settings?.working_hours_end ?? "18:00");
    const workingDays: number[] = settings?.working_days ?? [1, 2, 3, 4, 5];
    const durationMs = service.duration_minutes * 60000;

    const now = new Date();
    const rangeEnd = new Date(now.getTime() + DAYS_AHEAD * 86400000);

    const [googleBusy, { data: bookings }] = await Promise.all([
      getBusy(now.toISOString(), rangeEnd.toISOString()).catch(() => []),
      supabase
        .from("bookings")
        .select("starts_at,ends_at")
        .in("status", ["pending", "awaiting_payment", "confirmed"])
        .lt("starts_at", rangeEnd.toISOString())
        .gt("ends_at", now.toISOString()),
    ]);

    const busy = [
      ...googleBusy.map((b) => ({
        start: new Date(b.start).getTime(),
        end: new Date(b.end).getTime(),
      })),
      ...(bookings ?? []).map((b) => ({
        start: new Date(b.starts_at).getTime(),
        end: new Date(b.ends_at).getTime(),
      })),
    ];

    const earliest = now.getTime() + LEAD_MINUTES * 60000;
    const today = localYMD(tz, now);
    const base = Date.UTC(today.y, today.m - 1, today.d);
    const days: { date: string; slots: { starts_at: string; ends_at: string }[] }[] = [];

    for (let i = 0; i < DAYS_AHEAD; i++) {
      const dd = new Date(base + i * 86400000);
      const y = dd.getUTCFullYear();
      const m = dd.getUTCMonth() + 1;
      const d = dd.getUTCDate();
      if (!workingDays.includes(dd.getUTCDay())) continue;

      const dayOpen = zonedToUtc(y, m, d, open.h, open.m, tz).getTime();
      const dayClose = zonedToUtc(y, m, d, close.h, close.m, tz).getTime();

      const slots: { starts_at: string; ends_at: string }[] = [];
      for (let s = dayOpen; s + durationMs <= dayClose; s += durationMs) {
        const e = s + durationMs;
        if (s < earliest) continue;
        if (busy.some((b) => s < b.end && e > b.start)) continue;
        slots.push({
          starts_at: new Date(s).toISOString(),
          ends_at: new Date(e).toISOString(),
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
