// Authenticated, admin-only Edge Function: handle a turno beyond cancellation.
//   action "block"      → hold a slot under a name (a cash client at the desk,
//                         a walk-in, maintenance): a bookings row with no
//                         client and a label, status confirmed, so every guard
//                         that protects a turno protects the block (ADR 0014).
//   action "unblock"    → free a block (cancelled; no notice, nobody to tell).
//   action "no_show"    → mark a confirmed, already-started turno as a no-show.
//   action "reschedule" → move the SAME booking to a new time (preserving id,
//                         payment linkage, google_event_id); re-validates the
//                         slot (grid, hours, lead — NOT the client booking
//                         window: admins may book further ahead) and lets the
//                         DB EXCLUDE / one-per-day arbitrate.
// There is NO manual confirm: a turno is confirmed by its payment (Talo) or
// not at all. Cancellation stays in cancel-booking. Mirrors admin-payment's
// is_admin gate. The client is told about a reschedule (queued by the RPC with
// actor 'admin', so the other admins are not).
import { responder, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import { createEvent, getBusy, patchEventStatus, patchEventTime } from "../_shared/google.ts";
import { defer } from "../_shared/background.ts";
import { type Busy, validateSlot } from "../_shared/booking-rules.ts";
import { loadServiceWithSector, sectorCalendarId, sectorSettings } from "../_shared/sector.ts";
import { kick } from "../_shared/notify.ts";

const ACTIONS = ["block", "unblock", "no_show", "reschedule"];
const ACTIVE = ["pending", "awaiting_payment", "confirmed"];

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
  try {
    const { booking_id, action, starts_at, resource_id, service_id, label } = await req.json();
    if (!ACTIONS.includes(action) || (action !== "block" && !booking_id)) {
      return json({ error: "Datos inválidos" }, 400);
    }

    const {
      data: { user },
    } = await userClient(req).auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);

    const admin = adminClient();
    const { data: me } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();
    if (!me?.is_admin) return json({ error: "No autorizado" }, 403);

    // ── block ─────────────────────────────────────────────────────────────────
    if (action === "block") {
      const name = typeof label === "string" ? label.trim() : "";
      if (!service_id || !name || name.length > 60) {
        return json({ error: "Datos inválidos" }, 400);
      }
      const start = new Date(starts_at);
      if (isNaN(start.getTime())) return json({ error: "Fecha inválida" }, 400);
      if (start.getTime() < Date.now()) return json({ error: "Ese horario ya pasó." }, 400);

      // The service only names the sector (and the calendar): the slot length
      // comes from the sector's grid like any turno.
      const service = await loadServiceWithSector(admin, service_id);
      if (!service) return json({ error: "Servicio no disponible" }, 404);
      const settings = sectorSettings(service.sectors);
      const calendar = sectorCalendarId(service.sectors);
      const googleBusy = await getBusy(
        start.toISOString(),
        new Date(start.getTime() + 86400000).toISOString(),
        calendar,
      ).catch(() => []);
      const busy: Busy[] = googleBusy.map((b) => ({
        start: new Date(b.start).getTime(),
        end: new Date(b.end).getTime(),
      }));
      const check = validateSlot({ startMs: start.getTime(), settings, busy, enforceWindow: false });
      if (!check.ok) return json({ error: check.error }, 409);
      const end = new Date(check.endMs);

      const bed = typeof resource_id === "string" && resource_id ? resource_id : null;
      const { data: block, error: insErr } = await admin
        .from("bookings")
        .insert({
          user_id: null,
          block_label: name,
          block_by: user.id,
          service_id,
          resource_id: bed,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          status: "confirmed",
        })
        .select("id, starts_at, ends_at")
        .single();
      if (insErr || !block) {
        if (insErr?.code === "23P01") {
          return json({ error: "Ese horario ya está ocupado. Elegí otro." }, 409);
        }
        return json({ error: insErr?.message ?? "No se pudo bloquear." }, 400);
      }
      defer(async () => {
        const eventId = await createEvent({
          summary: `Bloqueado — ${name}`,
          description: `Bloqueo ${block.id} (${name})`,
          start: block.starts_at,
          end: block.ends_at,
          status: "confirmed",
          calendar,
        });
        if (eventId) {
          await admin.from("bookings").update({ google_event_id: eventId }).eq("id", block.id);
        }
      });
      return json({ ok: true, booking: block });
    }

    const { data: booking } = await admin
      .from("bookings")
      .select("id, status, starts_at, ends_at, service_id, google_event_id, membership_id, block_label")
      .eq("id", booking_id)
      .single();
    if (!booking) return json({ error: "Turno no encontrado" }, 404);

    // ── unblock ───────────────────────────────────────────────────────────────
    if (action === "unblock") {
      if (!booking.block_label) return json({ error: "No es un bloqueo." }, 409);
      if (!ACTIVE.includes(booking.status)) return json({ error: "Ya está liberado." }, 409);
      const { error: upErr } = await admin
        .from("bookings")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancelled_by: user.id,
          cancellation_reason: "unblock",
        })
        .eq("id", booking.id)
        .in("status", ACTIVE);
      if (upErr) return json({ error: "No se pudo liberar." }, 409);
      if (booking.google_event_id) {
        try {
          await patchEventStatus(booking.google_event_id, "cancelled");
        } catch (_) {
          /* calendar best-effort */
        }
      }
      return json({ ok: true });
    }

    if (action === "no_show") {
      if (booking.status !== "confirmed") {
        return json(
          { error: "Solo un turno confirmado puede marcarse como no asistido." },
          409,
        );
      }
      if (new Date(booking.starts_at).getTime() > Date.now()) {
        return json({ error: "El turno todavía no empezó." }, 409);
      }
      const { error: nsErr } = await admin
        .from("bookings")
        .update({ status: "no_show" })
        .eq("id", booking.id)
        .eq("status", "confirmed");
      if (nsErr) return json({ error: "No se pudo marcar el turno." }, 409);
      if (booking.google_event_id) {
        try {
          await patchEventStatus(booking.google_event_id, "cancelled");
        } catch (_) {
          /* calendar best-effort */
        }
      }
      return json({ ok: true });
    }

    // ── reschedule ────────────────────────────────────────────────────────────
    if (!ACTIVE.includes(booking.status)) {
      return json({ error: "Este turno no se puede reprogramar." }, 409);
    }
    const start = new Date(starts_at);
    if (isNaN(start.getTime())) return json({ error: "Fecha inválida" }, 400);
    if (start.getTime() < Date.now()) {
      return json({ error: "Ese horario ya pasó." }, 400);
    }

    const service = await loadServiceWithSector(admin, booking.service_id);
    if (!service) return json({ error: "Servicio no disponible" }, 404);
    // A turno takes one slot of its new range; an abono class keeps its length.
    const lengthMs = booking.membership_id
      ? new Date(booking.ends_at).getTime() - new Date(booking.starts_at).getTime()
      : undefined;

    const settings = sectorSettings(service.sectors);
    const googleBusy = await getBusy(
      start.toISOString(),
      new Date(start.getTime() + 86400000).toISOString(),
      sectorCalendarId(service.sectors),
    ).catch(() => []);
    const busy: Busy[] = googleBusy.map((b) => ({
      start: new Date(b.start).getTime(),
      end: new Date(b.end).getTime(),
    }));
    const check = validateSlot({
      startMs: start.getTime(),
      settings,
      busy,
      lengthMs,
      enforceWindow: false,
    });
    if (!check.ok) return json({ error: check.error }, 409);
    const end = new Date(check.endMs);

    // Update the SAME row; the EXCLUDE / one-per-day constraints re-check on update
    // (a row never conflicts with itself). resource_id = null makes the DB give it
    // a bed that is free at the new time (its current one may not be).
    // An explicit bed (the admin picked one) is checked by the DB to belong to
    // the sector; the EXCLUDE arbitrates whether it is free.
    const bed = typeof resource_id === "string" && resource_id ? resource_id : null;
    const { data: moved, error: updErr } = await admin.rpc("reschedule_booking", {
      p_booking: booking.id,
      p_starts: start.toISOString(),
      p_ends: end.toISOString(),
      p_resource: bed,
      p_actor: "admin",
    });
    if (!updErr && moved?.result !== "ok") {
      return json({ error: "Este turno no se puede reprogramar." }, 409);
    }
    if (updErr) {
      if (updErr.code === "23P01") {
        return json({ error: "Ese horario ya está ocupado. Elegí otro." }, 409);
      }
      if (updErr.code === "23505") {
        return json({ error: "El cliente ya tiene un turno ese día." }, 409);
      }
      return json({ error: updErr.message }, 400);
    }
    if (booking.google_event_id) {
      try {
        await patchEventTime(booking.google_event_id, start.toISOString(), end.toISOString());
      } catch (_) {
        /* calendar best-effort */
      }
    }
    kick(admin);
    return json({ ok: true });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
