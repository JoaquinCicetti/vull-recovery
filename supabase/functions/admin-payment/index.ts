// Authenticated, admin-only Edge Function: approve or reject a manual payment.
// Approving confirms the booking and finalizes the Google Calendar event.
import { responder, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import { patchEventStatus } from "../_shared/google.ts";
import { sendBookingConfirmation, sendPackConfirmation } from "../_shared/email.ts";

// A booking may only be confirmed out of these states. `cancelled`, `expired` and
// `no_show` are terminal: confirming them would resurrect a turno whose slot the
// no-overlap constraint has already handed to somebody else.
const CONFIRMABLE = ["pending", "awaiting_payment"];

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
      .select("id, booking_id, kind, service_id, status")
      .eq("id", payment_id)
      .single();
    if (!pay) return json({ error: "Pago no encontrado" }, 404);

    // Only act on a payment still awaiting a decision. Re-approving a settled row
    // used to re-run the confirm/grant side effects (a second confirmation email,
    // and — for a rejected pack — credits granted after the fact).
    if (pay.status !== "pending") {
      return json(
        {
          error:
            pay.status === "approved"
              ? "Este pago ya fue aprobado."
              : "Este pago ya fue rechazado.",
        },
        409,
      );
    }

    if (action === "reject") {
      await admin
        .from("payments")
        .update({ status: "rejected" })
        .eq("id", payment_id);
      return json({ ok: true });
    }

    // ── approve ──────────────────────────────────────────────────────────────
    // Pack purchase: grant the credits (idempotent) — no booking to confirm.
    if (pay.kind === "pack") {
      await admin
        .from("payments")
        .update({ status: "approved" })
        .eq("id", payment_id);
      await admin.rpc("grant_pack_credits", { p_payment_id: payment_id });
      // Tell the client their sessions are live (best-effort; was silent before).
      await sendPackConfirmation(admin, payment_id);
      return json({ ok: true });
    }

    // Booking payment. Confirm the booking FIRST and only mark the money as
    // approved if that actually succeeded.
    //
    // Previously the payment was flipped to `approved` up front, the booking
    // UPDATE ran with its error discarded, and the confirmation email was sent
    // unconditionally. If the hold had lapsed (booking `expired`/`cancelled`) and
    // someone else had taken the slot, the UPDATE hit the bookings_no_overlap
    // EXCLUDE constraint (23P01), the error was dropped, and the client was told
    // "turno confirmado" for a slot that belongs to another client.
    const { data: booking } = await admin
      .from("bookings")
      .select("id, google_event_id, status")
      .eq("id", pay.booking_id)
      .single();
    if (!booking) return json({ error: "Turno no encontrado" }, 404);

    if (booking.status === "confirmed") {
      // Already confirmed by another path (manual confirm) — just settle the money.
      await admin
        .from("payments")
        .update({ status: "approved" })
        .eq("id", payment_id);
      return json({ ok: true });
    }

    if (!CONFIRMABLE.includes(booking.status)) {
      return json(
        {
          error:
            "El turno ya no está activo (venció o fue cancelado). Reprogramalo desde el turno o rechazá el pago y devolvé el dinero.",
        },
        409,
      );
    }

    const { error: updErr } = await admin
      .from("bookings")
      .update({ status: "confirmed", hold_expires_at: null })
      .eq("id", booking.id)
      .in("status", CONFIRMABLE);
    if (updErr) {
      // 23P01 = the slot was taken while this payment sat in the queue.
      return json(
        {
          error:
            updErr.code === "23P01"
              ? "Ese horario ya fue tomado por otro turno. Reprogramá este turno antes de aprobar el pago."
              : "No se pudo confirmar el turno. El pago quedó pendiente.",
        },
        409,
      );
    }

    await admin
      .from("payments")
      .update({ status: "approved" })
      .eq("id", payment_id);

    if (booking.google_event_id) {
      try {
        await patchEventStatus(booking.google_event_id, "confirmed");
      } catch (_) {
        /* calendar best-effort */
      }
    }
    // Email the confirmation receipt (best-effort; no-ops if email unset).
    await sendBookingConfirmation(admin, booking.id);

    return json({ ok: true });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
