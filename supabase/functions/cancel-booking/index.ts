// Authenticated Edge Function: cancel a booking.
// The owner can cancel their own future booking; an admin can cancel any.
// Setting status='cancelled' frees the slot (the no-overlap EXCLUDE constraint
// ignores cancelled rows). Best-effort: cancels the Google Calendar event,
// clears any pending manual payment, and emails the client.
import { responder, errMessage } from "../_shared/cors.ts";
import { killLiveTaloPayments } from "../_shared/talo-settle.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import { patchEventStatus } from "../_shared/google.ts";
import { sendBookingCancellation, notifyAdmins } from "../_shared/email.ts";

const CANCELLABLE = ["pending", "awaiting_payment", "confirmed"];

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
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
      .select("id, user_id, status, starts_at, google_event_id, membership_id")
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

    // An abono class: cancelling only frees the bed (nothing comes back; the
    // remedy is moving it). While the first cuota is unpaid the schedule is one
    // thing: the client drops the whole signup from Mi plan instead.
    if (booking.membership_id) {
      if (!isAdmin && booking.status !== "confirmed") {
        return json(
          { error: "Tu abono todavía no está pago. Si no lo querés, cancelalo desde Mi plan." },
          409,
        );
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
        .eq("id", booking.id)
        .in("status", CANCELLABLE);
      if (updErr) return json({ error: updErr.message }, 400);
      await sendBookingCancellation(admin, booking.id, { byAdmin: isAdmin, credit: "membership" });
      if (!isAdmin) await notifyAdmins(admin, "booking_cancelled_by_client", booking.id);
      return json({ ok: true, credit: "membership" });
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

    // Kill any live Talo CVU FIRST, so a cancelled turno cannot keep quietly
    // accepting the client's money; then clear the pending rows so they leave
    // the admin queue. (An approved payment becomes a credit below.)
    await killLiveTaloPayments(admin, booking.id);
    await admin
      .from("payments")
      .update({ status: "rejected" })
      .eq("booking_id", booking.id)
      .eq("status", "pending");

    // A paid turno (pack credit or approved payment) comes back as one credit:
    // always when an admin cancels, with >= 24h notice when the client does.
    // Idempotent; the rule lives in the RPC so every cancel path shares it.
    const { data: credit } = await admin.rpc("return_cancelled_booking", {
      p_booking_id: booking.id,
      p_by_admin: isAdmin,
    });

    // Notify the client (best-effort; no-ops if email unset).
    await sendBookingCancellation(admin, booking.id, { byAdmin: isAdmin, credit });
    // Alert the owner when a client cancels (not when the admin does it).
    if (!isAdmin) await notifyAdmins(admin, "booking_cancelled_by_client", booking.id);

    return json({ ok: true, credit });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
