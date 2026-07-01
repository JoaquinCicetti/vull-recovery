// Authenticated, admin-only Edge Function: handle a turno beyond cancellation.
//   action "confirm"    → manually confirm a pending/awaiting_payment turno (e.g.
//                         paid in cash); clears the hold, resolves any pending
//                         payment, finalizes the Google event, emails the client.
//   action "no_show"    → mark a confirmed, already-started turno as a no-show.
//   action "reschedule" → move the SAME booking to a new time (preserving id,
//                         payment linkage, google_event_id); re-validates the
//                         slot and lets the DB EXCLUDE / one-per-day arbitrate.
// Cancellation stays in cancel-booking. Mirrors admin-payment's is_admin gate.
import { responder, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import { getBusy, patchEventStatus, patchEventTime } from "../_shared/google.ts";
import { sendBookingConfirmation } from "../_shared/email.ts";
import { type Busy, type Settings, validateSlot } from "../_shared/booking-rules.ts";

const ACTIONS = ["confirm", "no_show", "reschedule"];
const ACTIVE = ["pending", "awaiting_payment", "confirmed"];

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
  try {
    const { booking_id, action, starts_at } = await req.json();
    if (!booking_id || !ACTIONS.includes(action)) {
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

    const { data: booking } = await admin
      .from("bookings")
      .select("id, status, starts_at, service_id, google_event_id")
      .eq("id", booking_id)
      .single();
    if (!booking) return json({ error: "Turno no encontrado" }, 404);

    if (action === "confirm") {
      if (!["pending", "awaiting_payment"].includes(booking.status)) {
        return json({ error: "Este turno no se puede confirmar." }, 409);
      }
      await admin
        .from("bookings")
        .update({ status: "confirmed", hold_expires_at: null })
        .eq("id", booking.id);
      await admin
        .from("payments")
        .update({ status: "approved" })
        .eq("booking_id", booking.id)
        .eq("status", "pending");
      if (booking.google_event_id) {
        try {
          await patchEventStatus(booking.google_event_id, "confirmed");
        } catch (_) {
          /* calendar best-effort */
        }
      }
      await sendBookingConfirmation(admin, booking.id);
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
      await admin.from("bookings").update({ status: "no_show" }).eq("id", booking.id);
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

    const [{ data: service }, { data: row }] = await Promise.all([
      admin.from("services").select("duration_minutes").eq("id", booking.service_id).single(),
      admin.from("settings").select("*").eq("id", true).single(),
    ]);
    if (!service) return json({ error: "Servicio no disponible" }, 404);
    const durationMs = service.duration_minutes * 60000;
    const end = new Date(start.getTime() + durationMs);

    const settings: Settings = {
      working_hours_start: row?.working_hours_start ?? "09:00",
      working_hours_end: row?.working_hours_end ?? "18:00",
      working_days: row?.working_days ?? [1, 2, 3, 4, 5],
      timezone: row?.timezone ?? "America/Argentina/Buenos_Aires",
    };
    const googleBusy = await getBusy(start.toISOString(), end.toISOString()).catch(
      () => [],
    );
    const busy: Busy[] = googleBusy.map((b) => ({
      start: new Date(b.start).getTime(),
      end: new Date(b.end).getTime(),
    }));
    const check = validateSlot({ startMs: start.getTime(), durationMs, settings, busy });
    if (!check.ok) return json({ error: check.error }, 409);

    // Update the SAME row; the EXCLUDE / one-per-day constraints re-check on update
    // (a row never conflicts with itself).
    const { error: updErr } = await admin
      .from("bookings")
      .update({ starts_at: start.toISOString(), ends_at: end.toISOString() })
      .eq("id", booking.id);
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
    return json({ ok: true });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
