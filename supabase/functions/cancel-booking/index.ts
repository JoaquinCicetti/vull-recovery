// Authenticated Edge Function: cancel a booking.
// The owner can cancel their own future booking; an admin can cancel any.
// Setting status='cancelled' frees the slot (the no-overlap EXCLUDE constraint
// ignores cancelled rows). Best-effort: cancels the Google Calendar event,
// clears any pending manual payment, and emails the client.
import { json, handleOptions, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import { patchEventStatus } from "../_shared/google.ts";
import { sendBookingCancellation } from "../_shared/email.ts";

const CANCELLABLE = ["pending", "awaiting_payment", "confirmed"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions();
  try {
    const { booking_id, reason } = await req.json();
    if (!booking_id) return json({ error: "Falta el turno" }, 400);

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
    const isAdmin = Boolean(me?.is_admin);

    const { data: booking } = await admin
      .from("bookings")
      .select("id, user_id, status, starts_at, google_event_id")
      .eq("id", booking_id)
      .single();
    if (!booking) return json({ error: "Turno no encontrado" }, 404);

    // Only the owner or an admin may cancel.
    if (booking.user_id !== user.id && !isAdmin) {
      return json({ error: "No autorizado" }, 403);
    }

    if (!CANCELLABLE.includes(booking.status)) {
      return json({ error: "Este turno no se puede cancelar." }, 409);
    }

    // Clients can't cancel a turno that already started; admins can (to clear
    // the schedule).
    if (!isAdmin && new Date(booking.starts_at).getTime() < Date.now()) {
      return json({ error: "Ese turno ya pasó." }, 409);
    }

    const { error: updErr } = await admin
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: user.id,
        cancellation_reason: typeof reason === "string" ? reason : null,
        hold_expires_at: null,
      })
      .eq("id", booking.id);
    if (updErr) return json({ error: updErr.message }, 400);

    // Cancel the calendar event (best-effort).
    if (booking.google_event_id) {
      try {
        await patchEventStatus(booking.google_event_id, "cancelled");
      } catch (_) {
        /* calendar best-effort */
      }
    }

    // Clear any still-pending manual payment so it leaves the admin queue.
    // (Refunds of accredited payments are handled later, with Mobbex.)
    await admin
      .from("payments")
      .update({ status: "rejected" })
      .eq("booking_id", booking.id)
      .eq("status", "pending");

    // Notify the client (best-effort; no-ops if email unset).
    await sendBookingCancellation(admin, booking.id, { byAdmin: isAdmin });

    return json({ ok: true });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
