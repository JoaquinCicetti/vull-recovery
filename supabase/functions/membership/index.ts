// Authenticated Edge Function: a client's own abono (monthly plan).
//
//   action "create"         { service_id, slots:[{weekday,start_time,resource_id}],
//                             locked, starts_on? }
//                           → { membership, period }. The schedule is held for
//                           sectors.hold_minutes like a booking; the client pays
//                           the first (prorated) cuota through create-payment.
//   action "set_locked"     { membership_id, locked } → keep the same schedule
//                           and beds every month, or let the abono end.
//   action "cancel_pending" { membership_id } → drop an unpaid signup.
//
// Every rule is in SQL (create_membership & co., service-role only); this
// function authenticates, shape-checks and maps errors (_shared/membership.ts).
import { responder, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import {
  housekeeping,
  killLivePeriodPayments,
  loadMembership,
  mapDbError,
  parseDate,
  parseSlots,
} from "../_shared/membership.ts";
import { canUseSector, loadServiceWithSector } from "../_shared/sector.ts";
import { validateSlot } from "../_shared/booking-rules.ts";
import { sectorSettings } from "../_shared/sector.ts";
import { setTaloExpiration } from "../_shared/talo.ts";
import { localYMD, parseHM, zonedToUtc } from "../_shared/time.ts";

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
  try {
    const body = await req.json();
    const action = body?.action;

    const { data: { user } } = await userClient(req).auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);
    const admin = adminClient();

    // ── create ────────────────────────────────────────────────────────────
    if (action === "create") {
      const slots = parseSlots(body.slots);
      if (!slots) return json({ error: "Elegí tus días y horarios." }, 400);
      const startsOn = body.starts_on ? parseDate(body.starts_on) : null;
      if (body.starts_on && !startsOn) return json({ error: "Fecha de inicio inválida." }, 400);

      const [, service] = await Promise.all([
        housekeeping(admin),
        loadServiceWithSector(admin, body.service_id),
      ]);
      if (!service || !service.active || service.billing !== "monthly") {
        return json({ error: "Plan no disponible" }, 404);
      }
      const sector = service.sectors;
      if (!(await canUseSector(admin, sector, user))) {
        return json({ error: "Plan no disponible" }, 404);
      }

      // Same slot rules as a single turno (open range, grid), checked on each
      // weekday's next occurrence; lead time is applied per class by the DB and
      // a schedule runs all month, so the client booking window doesn't apply.
      // A class lasts its plan's duration, which must fit in the range too.
      const settings = { ...sectorSettings(sector), lead_minutes: 0 };
      const tz = sector.timezone;
      const t = localYMD(tz, new Date());
      for (const s of slots) {
        const { h, m } = parseHM(s.start_time);
        const base = new Date(Date.UTC(t.y, t.m - 1, t.d));
        const ahead = (s.weekday - base.getUTCDay() + 7) % 7 || 7;
        const d = new Date(base.getTime() + ahead * 86400000);
        const startMs = zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, m, tz)
          .getTime();
        const check = validateSlot({
          startMs,
          settings,
          busy: [],
          now: 0,
          lengthMs: service.duration_minutes * 60000,
          enforceWindow: false,
        });
        if (!check.ok) return json({ error: check.error }, 409);
      }

      const { data, error } = await admin.rpc("create_membership", {
        p_user: user.id,
        p_service: service.id,
        p_slots: slots,
        p_locked: Boolean(body.locked),
        p_starts_on: startsOn,
        p_hold: `${sector.hold_minutes} minutes`,
        p_created_by: user.id,
      });
      if (error) {
        const m = mapDbError(error, { classesPerWeek: service.classes_per_week });
        return json({ error: m.error }, m.status);
      }
      return json({ membership: data.membership, period: data.period });
    }

    // ── actions on an existing membership ─────────────────────────────────
    const id = body?.membership_id;
    if (typeof id !== "string") return json({ error: "Datos inválidos" }, 400);
    const m = await loadMembership(admin, id);
    if (!m || m.userId !== user.id) return json({ error: "Abono no encontrado" }, 404);

    if (action === "set_locked") {
      const { data, error } = await admin.rpc("set_membership_locked", {
        p_membership: id,
        p_locked: Boolean(body.locked),
      });
      if (error) {
        const e = mapDbError(error);
        return json({ error: e.error }, e.status);
      }
      // Unlocking voids next month's cuota: kill its live CVU, if any.
      if (!body.locked) {
        const { data: voided } = await admin
          .from("membership_periods")
          .select("id")
          .eq("membership_id", id)
          .eq("status", "void");
        await killLivePeriodPayments(admin, (voided ?? []).map((p) => p.id), setTaloExpiration);
      }
      return json({ membership: data });
    }

    if (action === "cancel_pending") {
      if (m.status !== "pending") return json({ error: "Ese abono ya está pago." }, 409);
      const { data: periods } = await admin
        .from("membership_periods")
        .select("id")
        .eq("membership_id", id);
      // Never leave a CVU that can take money for a schedule we give away.
      await killLivePeriodPayments(admin, (periods ?? []).map((p) => p.id), setTaloExpiration);
      const { error } = await admin.rpc("cancel_pending_membership", {
        p_membership: id,
        p_user: user.id,
      });
      if (error) {
        const e = mapDbError(error);
        return json({ error: e.error }, e.status);
      }
      return json({ ok: true });
    }

    return json({ error: "Acción inválida" }, 400);
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
