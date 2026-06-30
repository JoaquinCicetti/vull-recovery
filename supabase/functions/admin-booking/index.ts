// Authenticated, admin-only Edge Function: handle a turno beyond cancellation.
//   action "confirm"  → manually confirm a pending/awaiting_payment turno (e.g.
//                       paid in cash); clears the hold, resolves any pending
//                       payment so it leaves the verify queue, finalizes the
//                       Google event, and emails the confirmation.
//   action "no_show"  → mark a confirmed turno (whose time has passed) as a
//                       no-show. Terminal status; frees the slot/day.
// Cancellation stays in cancel-booking (owner-or-admin). Mirrors admin-payment's
// is_admin gate.
import { responder, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import { patchEventStatus } from "../_shared/google.ts";
import { sendBookingConfirmation } from "../_shared/email.ts";

const ACTIONS = ["confirm", "no_show"];

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
  try {
    const { booking_id, action } = await req.json();
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
      .select("id, status, starts_at, google_event_id")
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
      // Resolve any pending payment so it leaves the admin verify queue (the
      // admin is asserting payment was received, e.g. cash).
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

    // no_show
    if (booking.status !== "confirmed") {
      return json(
        { error: "Solo un turno confirmado puede marcarse como no asistido." },
        409,
      );
    }
    if (new Date(booking.starts_at).getTime() > Date.now()) {
      return json({ error: "El turno todavía no empezó." }, 409);
    }
    await admin
      .from("bookings")
      .update({ status: "no_show" })
      .eq("id", booking.id);
    if (booking.google_event_id) {
      try {
        await patchEventStatus(booking.google_event_id, "cancelled");
      } catch (_) {
        /* calendar best-effort */
      }
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
