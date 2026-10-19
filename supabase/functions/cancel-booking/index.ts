// Authenticated Edge Function: cancel a booking.
// The owner can cancel their own future booking; an admin can cancel any.
// Setting status='cancelled' frees the slot (the no-overlap EXCLUDE constraint
// ignores cancelled rows). The write, the credit and the notices are one RPC
// (cancel_booking); only once it committed, the Talo CVU kill and the Google
// Calendar event.
import { responder, errMessage } from "../_shared/cors.ts";
import { expireTaloPayments, liveTaloPaymentIds } from "../_shared/talo-settle.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import { patchEventStatus } from "../_shared/google.ts";
import { kick } from "../_shared/notify.ts";

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
    if (booking.membership_id && !isAdmin && booking.status !== "confirmed") {
      return json(
        { error: "Tu abono todavía no está pago. Si no lo querés, cancelalo desde Mi plan." },
        409,
      );
    }

    // The live Talo CVUs, read now: cancel_booking rejects their rows. They are
    // killed only after it succeeds; a failed cancel leaves the turno active
    // and its CVU still able to take the client's money.
    const liveCvus = booking.membership_id ? [] : await liveTaloPaymentIds(admin, booking.id);

    // cancel_booking: the guarded UPDATE, pending payments rejected, a paid
    // turno back as one credit (always when an admin cancels, with notice when
    // the client does; return_cancelled_booking), and the notices: the client
    // always, the admins when the client did it.
    const { data: credit, error: rpcErr } = await admin.rpc("cancel_booking", {
      p_booking: booking.id,
      p_by: user.id,
      p_reason: typeof reason === "string" ? reason : null,
      p_by_admin: isAdmin,
    });
    if (rpcErr) return json({ error: rpcErr.message }, 400);
    if (credit === "gone") return json({ error: "Este turno no se puede cancelar." }, 409);

    // A cancelled turno must not keep quietly accepting the client's money.
    await expireTaloPayments(liveCvus);

    // Cancel the calendar event (best-effort).
    if (booking.google_event_id) {
      try {
        await patchEventStatus(booking.google_event_id, "cancelled");
      } catch (_) {
        /* calendar best-effort */
      }
    }
    kick(admin);

    return json({ ok: true, credit });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
