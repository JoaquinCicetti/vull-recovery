// Public Edge Function: what a monthly plan's weekly picker can offer.
//
// Body: { service_id, starts_on?: "YYYY-MM-DD", locked: boolean }
//
// For each weekday, the class times of the sector's open ranges (stepping by
// the plan's duration from each range's opening), and for each time the beds
// that are free on EVERY occurrence the membership would take:
//   * from starts_on to the end of that month, and
//   * when `locked`, through the end of next month too (a recurring member gets
//     next month materialized at signup, so its beds must be free as well).
// Occurrences inside the lead time don't count (they would not be booked).
//
// A preview, not a promise: create_membership inserts every class and the
// bookings_no_overlap EXCLUDE is what decides. The counts let the picker show
// "3 clases este mes" and estimate the prorated first cuota.
import { adminClient, userClient } from "../_shared/supabase.ts";
import { responder, errMessage } from "../_shared/cors.ts";
import { housekeeping, parseDate } from "../_shared/membership.ts";
import { localYMD, parseHM, zonedToUtc } from "../_shared/time.ts";
import { canUseSector, loadServiceWithSector } from "../_shared/sector.ts";

const ACTIVE = ["pending", "awaiting_payment", "confirmed"];

const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const parse = (s: string) => s.split("-").map(Number) as [number, number, number];
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const nextMonth = (y: number, m: number): [number, number] => (m === 12 ? [y + 1, 1] : [y, m + 1]);

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
  try {
    const body = await req.json();
    const serviceId = body?.service_id;
    if (!serviceId) return json({ error: "service_id requerido" }, 400);
    const locked = Boolean(body?.locked);

    const admin = adminClient();
    const [, service] = await Promise.all([
      housekeeping(admin),
      loadServiceWithSector(admin, serviceId),
    ]);
    if (!service || !service.active || service.billing !== "monthly") {
      return json({ error: "Plan no disponible" }, 404);
    }
    const sector = service.sectors;
    if (!sector.active) {
      const { data: { user } } = await userClient(req).auth.getUser();
      if (!(await canUseSector(admin, sector, user))) {
        return json({ error: "Plan no disponible" }, 404);
      }
    }

    const tz = sector.timezone;
    const now = Date.now();
    const t = localYMD(tz, new Date(now));
    const today = ymd(t.y, t.m, t.d);
    const [ny, nm] = nextMonth(t.y, t.m);
    const nextFirst = ymd(ny, nm, 1);

    const startsOn = body?.starts_on ? parseDate(body.starts_on) : today;
    if (!startsOn || startsOn < today || startsOn > nextFirst) {
      return json({ error: "Fecha de inicio inválida." }, 400);
    }
    const [sy, sm, sd] = parse(startsOn);
    const monthEnd = ymd(sy, sm, daysIn(sy, sm));
    // Locked: through the end of next month (relative to today), never less
    // than the start month.
    const [ly, lm] = locked && `${sy}-${sm}` === `${t.y}-${t.m}` ? [ny, nm] : [sy, sm];
    const rangeEnd = ymd(ly, lm, daysIn(ly, lm));

    const durMin = service.duration_minutes as number;
    const durMs = durMin * 60000;
    const leadCut = now + sector.lead_minutes * 60000;

    const [{ data: resources }, { data: bookings }] = await Promise.all([
      admin
        .from("resources")
        .select("id, name")
        .eq("sector_id", sector.id)
        .eq("active", true)
        .order("sort_order")
        .order("created_at"),
      admin
        .from("bookings")
        .select("resource_id, starts_at, ends_at")
        .eq("sector_id", sector.id)
        .in("status", ACTIVE)
        .gte("ends_at", zonedToUtc(sy, sm, sd, 0, 0, tz).toISOString())
        .lt("starts_at", zonedToUtc(ly, lm, daysIn(ly, lm) + 1, 0, 0, tz).toISOString()),
    ]);
    const beds = (resources ?? []) as { id: string; name: string }[];
    const taken = new Map<string, { s: number; e: number }[]>();
    for (const b of bookings ?? []) {
      const list = taken.get(b.resource_id) ?? [];
      list.push({ s: new Date(b.starts_at).getTime(), e: new Date(b.ends_at).getTime() });
      taken.set(b.resource_id, list);
    }

    // Dates of the range per weekday, and of the whole start month per weekday.
    const datesByWeekday = new Map<number, [number, number, number][]>();
    const fullMonthCount = new Map<number, number>();
    {
      let [y, m, d] = [sy, sm, sd];
      while (ymd(y, m, d) <= rangeEnd) {
        const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        const list = datesByWeekday.get(w) ?? [];
        list.push([y, m, d]);
        datesByWeekday.set(w, list);
        d++;
        if (d > daysIn(y, m)) [y, m, d] = [...nextMonth(y, m), 1];
      }
      for (let day = 1; day <= daysIn(sy, sm); day++) {
        const w = new Date(Date.UTC(sy, sm - 1, day)).getUTCDay();
        fullMonthCount.set(w, (fullMonthCount.get(w) ?? 0) + 1);
      }
    }

    const hours = sector.sector_hours ?? [];
    const weekdays = [];
    for (let w = 0; w < 7; w++) {
      const ranges = hours
        .filter((h) => h.weekday === w)
        .sort((a, b) => a.opens.localeCompare(b.opens));
      if (ranges.length === 0) continue;
      const dates = datesByWeekday.get(w) ?? [];
      let thisMonth = 0;
      const times: { start_time: string; resources_free: string[] }[] = [];
      for (const r of ranges) {
        const o = parseHM(r.opens);
        const c = parseHM(r.closes);
        for (let min = o.h * 60 + o.m; min + durMin <= c.h * 60 + c.m; min += durMin) {
          const hh = Math.floor(min / 60);
          const mm = min % 60;
          const occ = dates
            .map(([y, m, d]) => ({ ym: `${y}-${m}`, s: zonedToUtc(y, m, d, hh, mm, tz).getTime() }))
            .filter((x) => x.s >= leadCut);
          if (occ.length === 0) continue;
          const free = beds.filter((bed) =>
            occ.every(
              (x) => !(taken.get(bed.id) ?? []).some((b) => x.s < b.e && x.s + durMs > b.s),
            )
          );
          times.push({
            start_time: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
            resources_free: free.map((b) => b.id),
          });
          // Every time of a weekday has the same dates; count them once.
          if (times.length === 1) thisMonth = occ.filter((x) => x.ym === `${sy}-${sm}`).length;
        }
      }
      if (times.length === 0) continue;
      weekdays.push({
        weekday: w,
        occurrences_this_month: thisMonth,
        occurrences_full_month: fullMonthCount.get(w) ?? 0,
        times,
      });
    }

    return json({
      timezone: tz,
      duration_minutes: durMin,
      classes_per_week: service.classes_per_week,
      price_ars: service.price_ars,
      range: { from: startsOn, to: rangeEnd, month_end: monthEnd },
      resources: beds,
      weekdays,
    });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
