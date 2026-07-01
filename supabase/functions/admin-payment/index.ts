// Authenticated, admin-only Edge Function: approve or reject a manual payment.
// Approving confirms the booking and finalizes the Google Calendar event.
import { responder, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import { patchEventStatus } from "../_shared/google.ts";
import { sendBookingConfirmation } from "../_shared/email.ts";

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
  try {
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

    const { payment_id, action } = await req.json();
    if (!payment_id || !["approve", "reject"].includes(action)) {
      return json({ error: "Datos inválidos" }, 400);
    }

    const { data: pay } = await admin
      .from("payments")
      .select("id, booking_id, kind, service_id")
      .eq("id", payment_id)
      .single();
    if (!pay) return json({ error: "Pago no encontrado" }, 404);

    if (action === "reject") {
      await admin
        .from("payments")
        .update({ status: "rejected" })
        .eq("id", payment_id);
      return json({ ok: true });
    }

    // approve
    await admin
      .from("payments")
      .update({ status: "approved" })
      .eq("id", payment_id);

    // Pack purchase: grant the credits (idempotent) — no booking to confirm.
    if (pay.kind === "pack") {
      await admin.rpc("grant_pack_credits", { p_payment_id: payment_id });
      return json({ ok: true });
    }

    const { data: booking } = await admin
      .from("bookings")
      .select("id, google_event_id, status")
      .eq("id", pay.booking_id)
      .single();

    if (booking && booking.status !== "confirmed") {
      await admin
        .from("bookings")
        .update({ status: "confirmed", hold_expires_at: null })
        .eq("id", booking.id);
      if (booking.google_event_id) {
        try {
          await patchEventStatus(booking.google_event_id, "confirmed");
        } catch (_) {
          /* calendar best-effort */
        }
      }
      // Email the confirmation receipt (best-effort; no-ops if email unset).
      await sendBookingConfirmation(admin, booking.id);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
