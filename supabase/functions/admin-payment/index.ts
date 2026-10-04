// Authenticated, admin-only Edge Function: resolve a payment by hand.
//   approve → confirms the booking (or grants the pack) and settles the money
//   reject  → marks it rejected; for a Talo row, only if no money actually moved
//   dismiss → clears admin_flag on a row that already settled (overpaid,
//             paid-without-slot, reversed) so it leaves the attention queue
//
// Two providers reach this queue and "reject" means different things for them:
// on a manual row it means "no money arrived"; on a Talo row the pesos are
// already in the account and cannot be declined, so rejecting one is only
// allowed once Talo confirms nothing was received (or it was refunded).
import { responder, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import { patchEventStatus } from "../_shared/google.ts";
import { sendBookingConfirmation, sendPackConfirmation } from "../_shared/email.ts";
import { CONFIRMABLE_LIST } from "../_shared/booking-status.ts";
import { getTaloPayment, setTaloExpiration } from "../_shared/talo.ts";

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
    if (!payment_id || !["approve", "reject", "dismiss"].includes(action)) {
      return json({ error: "Datos inválidos" }, 400);
    }

    const { data: pay } = await admin
      .from("payments")
      .select(
        "id, booking_id, kind, service_id, user_id, status, provider, talo_payment_id, reversed_at",
      )
      .eq("id", payment_id)
      .single();
    if (!pay) return json({ error: "Pago no encontrado" }, 404);

    if (action === "dismiss") {
      await admin.from("payments").update({ admin_flag: null }).eq("id", pay.id);
      return json({ ok: true });
    }

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
      if (pay.provider === "talo" && pay.talo_payment_id) {
        // The money may already be here. Refuse unless Talo says otherwise.
        const v = await getTaloPayment(pay.talo_payment_id);
        if (!v.ok) {
          return json(
            { error: "No pudimos consultar el pago en Talo. Revisalo en el panel de Talo antes de rechazarlo." },
            409,
          );
        }
        const moneyMoved = v.data.txCount > 0 || (v.data.received ?? 0) > 0;
        if (moneyMoved && !v.data.refunded) {
          return json(
            {
              error:
                "Hay dinero acreditado en Talo para este pago. Devolvelo desde el panel de Talo (o aprobalo) antes de rechazarlo.",
            },
            409,
          );
        }
        // Kill the CVU so it cannot take a late transfer after we rejected it.
        await setTaloExpiration(
          pay.talo_payment_id,
          new Date(Date.now() + 60_000).toISOString(),
        );
      }
      await admin
        .from("payments")
        .update({ status: "rejected", admin_flag: null })
        .eq("id", payment_id);
      return json({ ok: true });
    }

    // ── approve ──────────────────────────────────────────────────────────────
    // A manual receipt must never be approved on top of a Talo payment that
    // already settled the same thing: for a pack that grants the credits twice
    // (credit_ledger uniqueness is keyed on payment_id, so it cannot catch it).
    if (pay.provider === "manual") {
      let q = admin
        .from("payments")
        .select("id")
        .eq("provider", "talo")
        .eq("status", "approved");
      q = pay.kind === "pack"
        ? q.eq("kind", "pack").eq("service_id", pay.service_id).eq("user_id", pay.user_id)
        : q.eq("booking_id", pay.booking_id);
      const { data: twin } = await q.limit(1).maybeSingle();
      if (twin) {
        return json(
          { error: "Esto ya se pagó por transferencia automática (Talo). Rechazá el comprobante en vez de aprobarlo." },
          409,
        );
      }
    }

    // Pack purchase: settle FIRST, then grant — grant_pack_credits refuses unless
    // the payment is already `approved`. (Bookings are the opposite order.)
    if (pay.kind === "pack") {
      await admin
        .from("payments")
        .update({ status: "approved", admin_flag: null })
        .eq("id", payment_id);
      const { data: granted } = await admin.rpc("grant_pack_credits", {
        p_payment_id: payment_id,
      });
      // Tell the client their sessions are live (best-effort; was silent before).
      if (granted) await sendPackConfirmation(admin, payment_id);
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
        .update({ status: "approved", admin_flag: null })
        .eq("id", payment_id);
      return json({ ok: true });
    }

    if (!CONFIRMABLE_LIST.includes(booking.status)) {
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
      .in("status", CONFIRMABLE_LIST);
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
      .update({ status: "approved", admin_flag: null })
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
