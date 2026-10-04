// The ONE settle path for a Talo payment.
//
// Shared by talo-webhook (fast, client-triggered) and talo-reconcile (cron,
// catches anything the webhook lost) so the two can never drift — the same
// single-source discipline ./booking-rules.ts applies to slot validation.
//
// Two facts drive every branch:
//   1. The webhook body carries no status and no amount. Everything here comes
//      from an authenticated GET /payments/{id}. The body is used ONLY to decide
//      which of OUR rows to look at, and a row is only ever UPDATED, never
//      INSERTed from webhook input.
//   2. A bank transfer arrives before we hear about it and cannot be declined.
//      "Confirm the booking before settling the money" can no longer prevent a
//      bad outcome, only decide who gets alerted. So no branch below ever
//      pretends money did not arrive.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { CONFIRMABLE_LIST } from "./booking-status.ts";
import { patchEventStatus } from "./google.ts";
import {
  notifyAdmins,
  notifyAdminsSimple,
  sendBookingConfirmation,
  sendPackConfirmation,
} from "./email.ts";
import {
  getTaloPayment,
  setTaloExpiration,
  TALO_PAYMENT_ID_RE,
  taloUserId,
  type TaloPayment,
} from "./talo.ts";

export type SettleResult = {
  /** What the webhook should answer. 5xx invites a retry. */
  status: number;
  result: string;
};

type PaymentRow = {
  id: string;
  status: string;
  provider: string;
  kind: string | null;
  booking_id: string | null;
  service_id: string | null;
  user_id: string | null;
  amount_ars: number;
  external_reference: string | null;
  talo_payment_id: string | null;
  reversed_at: string | null;
  admin_flag: string | null;
  updated_at: string;
};

const ROW_COLS =
  "id, status, provider, kind, booking_id, service_id, user_id, amount_ars, external_reference, talo_payment_id, reversed_at, admin_flag, updated_at";

// Re-verifying an already-approved row on every duplicate webhook would turn a
// webhook storm into a Talo-API storm. 30s is long enough to absorb one.
const REVERIFY_QUIET_MS = 30_000;

/** Only the fields we choose, never the whole Talo object: it contains
 *  `webhook_url` (which carries our webhook token) and payments_select_own lets
 *  the buyer read this row. */
function auditBlob(v: TaloPayment) {
  return {
    provider: "talo",
    talo_payment_id: v.id,
    payment_status: v.status,
    requested: v.requested,
    received: v.received,
    currency: v.currency,
    tx_count: v.txCount,
    refunded: v.refunded,
    checked_at: new Date().toISOString(),
  };
}

/** Resolve OUR payment row from a Talo payment id. */
async function resolveRow(
  admin: SupabaseClient,
  paymentId: string,
): Promise<
  | { kind: "row"; row: PaymentRow }
  | { kind: "miss" }
  | { kind: "retry"; reason: string }
> {
  const { data: byId } = await admin
    .from("payments")
    .select(ROW_COLS)
    .eq("talo_payment_id", paymentId)
    .maybeSingle();
  if (byId) return { kind: "row", row: byId as PaymentRow };

  // Fallback for the create→patch window: create-payment inserts the row, calls
  // Talo, then patches talo_payment_id. If Talo fires before that patch commits
  // (or the patch failed) the event would otherwise be lost forever.
  //
  // This is safe ONLY because external_id comes from the authenticated GET, not
  // from the request body. The rule is "never resolve from the BODY", not "never
  // resolve by external_id" — do not weaken it into a body lookup.
  const verified = await getTaloPayment(paymentId);
  if (!verified.ok) {
    // Could not check. Do not decide anything; invite a retry.
    return { kind: "retry", reason: verified.reason };
  }
  const v = verified.data;
  const mine = taloUserId();
  if (mine && v.userId && v.userId !== mine) return { kind: "miss" };
  if (!v.externalId) return { kind: "miss" };

  const { data: byExt } = await admin
    .from("payments")
    .select(ROW_COLS)
    .eq("id", v.externalId)
    .eq("provider", "talo")
    .maybeSingle();
  if (!byExt) return { kind: "miss" };
  const row = byExt as PaymentRow;
  if (row.talo_payment_id) return { kind: "miss" }; // already claimed by another

  // Claim it, first-writer-wins.
  const { data: claimed } = await admin
    .from("payments")
    .update({ talo_payment_id: paymentId })
    .eq("id", row.id)
    .is("talo_payment_id", null)
    .select(ROW_COLS)
    .maybeSingle();
  if (!claimed) return { kind: "miss" };
  return { kind: "row", row: claimed as PaymentRow };
}

/**
 * Bring one Talo payment to its correct local state. Idempotent: called twice
 * with nothing changed, it writes nothing at all.
 */
export async function settleTaloPayment(
  admin: SupabaseClient,
  paymentId: unknown,
): Promise<SettleResult> {
  // Shape-check before any DB or network work, so a forged flood costs nothing.
  if (typeof paymentId !== "string" || !TALO_PAYMENT_ID_RE.test(paymentId)) {
    return { status: 200, result: "ignored_bad_id" };
  }

  const resolved = await resolveRow(admin, paymentId);
  if (resolved.kind === "miss") return { status: 200, result: "unknown_payment" };
  if (resolved.kind === "retry") {
    return { status: 503, result: `verify_unavailable:${resolved.reason}` };
  }
  const pay = resolved.row;

  // Quiet window: a settled row that was just checked needs no second look.
  if (
    pay.status === "approved" &&
    Date.now() - new Date(pay.updated_at).getTime() < REVERIFY_QUIET_MS
  ) {
    return { status: 200, result: "recently_verified" };
  }

  // ── The only source of truth ────────────────────────────────────────────────
  const verified = await getTaloPayment(paymentId);
  if (!verified.ok) {
    // Unverifiable is NOT "unpaid". Leave the row alone, tell a human, and invite
    // a retry. Falling back to the request body here is the exact Mobbex hole.
    await flag(admin, pay, "unverified");
    await notifyAdminsSimple(
      admin,
      "Pago Talo sin verificar",
      `No pudimos confirmar con Talo el pago ${paymentId} (${verified.reason}). Quedó pendiente: revisalo en el panel de Talo antes de confirmar el turno.`,
    );
    return { status: 503, result: `verify_failed:${verified.reason}` };
  }
  const v = verified.data;

  // Bind the two records together. A consistency check, not the auth boundary —
  // the auth boundary is the Bearer-scoped GET above.
  const mine = taloUserId();
  if (mine && v.userId && v.userId !== mine) {
    return { status: 200, result: "foreign_account" };
  }
  if (v.externalId && pay.external_reference && v.externalId !== pay.external_reference) {
    await notifyAdminsSimple(
      admin,
      "Pago Talo inconsistente",
      `El pago ${paymentId} dice external_id ${v.externalId} pero nuestra fila ${pay.id} espera ${pay.external_reference}. No se tocó nada.`,
    );
    return { status: 200, result: "external_id_mismatch" };
  }
  // Talo is multi-asset (crypto / PIX). Assert the rail rather than assume it.
  if (v.currency && v.currency.toUpperCase() !== "ARS") {
    await flag(admin, pay, "currency_mismatch");
    return { status: 200, result: "currency_mismatch" };
  }

  const st = v.status.toUpperCase();
  const moneyMoved = v.txCount > 0 || (v.received ?? 0) > 0;

  // ── Reversal after approval ────────────────────────────────────────────────
  // Never auto-cancel a confirmed booking from a webhook: the client may already
  // be standing in the building. A reversal is a human decision.
  if (v.refunded) {
    if (pay.status === "approved") {
      if (!pay.reversed_at) {
        await admin
          .from("payments")
          .update({
            reversed_at: new Date().toISOString(),
            admin_flag: "reversed",
            raw: auditBlob(v),
          })
          .eq("id", pay.id);
        await notifyAdminsSimple(
          admin,
          "⚠️ Pago Talo reintegrado",
          `El dinero del pago ${pay.id} (${pay.amount_ars}) volvió al cliente. El turno sigue confirmado: decidí vos si se cancela.`,
        );
      }
      return { status: 200, result: "reversed" };
    }
    await write(admin, pay, "rejected", "reversed", v);
    return { status: 200, result: "reversed_unapproved" };
  }

  // ── Status → our status ────────────────────────────────────────────────────
  let next: "pending" | "approved" | "rejected" = "pending";
  let adminFlag: string | null = null;
  let alert: { heading: string; body: string } | null = null;

  if (st === "SUCCESS" || st === "OVERPAID") {
    if (v.received === null) {
      // We could not read what actually arrived. Approving on a number we could
      // not parse is how the Mobbex webhook confirmed unpaid bookings.
      adminFlag = "unverified_amount";
      alert = {
        heading: "Pago Talo sin monto verificable",
        body: `El pago ${paymentId} figura ${st} pero no pudimos leer el monto acreditado. Quedó pendiente.`,
      };
    } else if (v.received >= pay.amount_ars) {
      next = "approved";
      if (v.received > pay.amount_ars) {
        adminFlag = "overpaid";
        alert = {
          heading: "Pago Talo de más",
          body: `Entraron ${v.received} para un pago de ${pay.amount_ars}. El turno se confirmó; hay que devolver la diferencia.`,
        };
      }
    } else {
      adminFlag = "amount_mismatch";
      alert = {
        heading: "Pago Talo incompleto",
        body: `Entraron ${v.received} de ${pay.amount_ars} en el pago ${paymentId}. NO se confirmó nada.`,
      };
    }
  } else if (st === "UNDERPAID") {
    adminFlag = "underpaid";
    alert = {
      heading: "Pago Talo incompleto",
      body: `El cliente transfirió ${v.received ?? "?"} de ${pay.amount_ars} (pago ${paymentId}). Quedó pendiente.`,
    };
  } else if (st === "EXPIRED") {
    if (moneyMoved) {
      // A transfer started at minute 29 can credit at minute 33. Marking that
      // `rejected` while holding the client's pesos is not an option.
      adminFlag = "expired_with_funds";
      alert = {
        heading: "⚠️ Plata en un CVU vencido",
        body: `El pago ${paymentId} venció pero registra movimientos (${v.received ?? "?"}). Revisalo en Talo: hay que confirmar el turno a mano o devolver.`,
      };
    } else {
      // Safe to reject: nothing arrived. If money lands later, the next webhook
      // re-evaluates this row (we only short-circuit on `approved`) and flips it
      // to pending + alert.
      next = "rejected";
    }
  } else if (st === "PENDING") {
    next = "pending";
  } else {
    adminFlag = "unknown_status";
    alert = {
      heading: "Estado de pago Talo desconocido",
      body: `El pago ${paymentId} devolvió "${v.status}", que no sabemos interpretar. Quedó pendiente.`,
    };
  }

  // A row we (or an admin) rejected stays rejected unless money actually moved:
  // a cancelled turno's CVU, or a superseded one, must not drift back to
  // `pending` in the minute before Talo's expiry takes effect.
  if (pay.status === "rejected" && !moneyMoved) {
    return { status: 200, result: "stays_rejected" };
  }

  // Nothing changed and nothing to say → write nothing. True idempotency. (A
  // leftover flag from an earlier failed check still gets cleared below.)
  if (next === pay.status && !adminFlag && !moneyMoved && !pay.admin_flag) {
    return { status: 200, result: "no_change" };
  }

  // ── Money is on its way: stop the lazy sweeper from expiring the slot ───────
  // The booking is deliberately left `pending` while the client transfers (so an
  // abandoned CVU frees the slot for free). Once Talo records a transaction the
  // booking must leave that sweep window.
  if (moneyMoved && next !== "approved" && pay.booking_id) {
    await admin
      .from("bookings")
      .update({ status: "awaiting_payment" })
      .eq("id", pay.booking_id)
      .eq("status", "pending");
  }

  if (next !== "approved") {
    await write(admin, pay, next, adminFlag, v);
    if (alert) await notifyAdminsSimple(admin, alert.heading, alert.body);
    return { status: 200, result: next + (adminFlag ? `:${adminFlag}` : "") };
  }

  // ── Approve ────────────────────────────────────────────────────────────────
  const outcome = pay.kind === "pack"
    ? await approvePack(admin, pay, adminFlag, v)
    : await approveBooking(admin, pay, adminFlag, v);

  if (alert) await notifyAdminsSimple(admin, alert.heading, alert.body);
  return outcome;
}

async function write(
  admin: SupabaseClient,
  pay: PaymentRow,
  status: string,
  adminFlag: string | null,
  v: TaloPayment,
) {
  await admin
    .from("payments")
    .update({ status, admin_flag: adminFlag, raw: auditBlob(v) })
    .eq("id", pay.id);
}

async function flag(admin: SupabaseClient, pay: PaymentRow, adminFlag: string) {
  await admin.from("payments").update({ admin_flag: adminFlag }).eq("id", pay.id);
}

// Packs settle BEFORE granting: grant_pack_credits refuses unless the payment is
// already `approved` (see 20260701120000_packs_credits.sql). Bookings are the
// exact opposite — confirm first, settle after. Do not "harmonize" the two or
// the grant becomes a silent no-op.
async function approvePack(
  admin: SupabaseClient,
  pay: PaymentRow,
  adminFlag: string | null,
  v: TaloPayment,
): Promise<SettleResult> {
  await write(admin, pay, "approved", adminFlag, v);
  const { data: granted } = await admin.rpc("grant_pack_credits", {
    p_payment_id: pay.id,
  });
  // Idempotent at the DB level (credit_ledger_purchase_uniq), so a replay grants
  // nothing and must not email the client a second time.
  if (granted) await sendPackConfirmation(admin, pay.id);
  return { status: 200, result: "approved_pack" };
}

async function approveBooking(
  admin: SupabaseClient,
  pay: PaymentRow,
  adminFlag: string | null,
  v: TaloPayment,
): Promise<SettleResult> {
  if (!pay.booking_id) {
    await write(admin, pay, "approved", adminFlag ?? "orphan_payment", v);
    return { status: 200, result: "approved_orphan" };
  }

  const { data: booking } = await admin
    .from("bookings")
    .select("id, google_event_id, status")
    .eq("id", pay.booking_id)
    .single();

  if (booking?.status === "confirmed") {
    await write(admin, pay, "approved", adminFlag, v);
    return { status: 200, result: "already_confirmed" };
  }

  // Re-assert the confirmable set in the UPDATE itself and CHECK what it did.
  // The mobbex webhook fired this update unguarded and discarded the result.
  const { data: updated, error: updErr } = await admin
    .from("bookings")
    .update({ status: "confirmed", hold_expires_at: null })
    .eq("id", pay.booking_id)
    .in("status", CONFIRMABLE_LIST)
    .select("id");

  const confirmed = !updErr && Array.isArray(updated) && updated.length > 0;

  if (!confirmed) {
    // The pesos already arrived and cannot be handed back automatically. Record
    // the money truthfully and shout for a human — do NOT mark it rejected.
    await write(admin, pay, "approved", "paid_no_slot", v);
    await notifyAdminsSimple(
      admin,
      "⚠️ Cobrado sin turno",
      `Entró la plata del pago ${pay.id} pero el turno ${pay.booking_id} ya no se puede confirmar${
        updErr?.code === "23P01" ? " (el horario lo tomó otro turno)" : ""
      }. Hay que reprogramarlo o devolver el dinero.`,
    );
    return { status: 200, result: "paid_no_slot" };
  }

  await write(admin, pay, "approved", adminFlag, v);

  if (booking?.google_event_id) {
    try {
      await patchEventStatus(booking.google_event_id, "confirmed");
    } catch (_) {
      /* calendar best-effort */
    }
  }
  await sendBookingConfirmation(admin, pay.booking_id);
  await notifyAdmins(admin, "booking_confirmed", pay.booking_id);
  return { status: 200, result: "approved_booking" };
}

/**
 * Kill every live CVU attached to a booking. Called whenever the turno goes
 * terminal (client/admin cancel, external calendar cancel): a cancelled turno
 * must not leave a CVU behind that can still quietly accept the client's money.
 * Best-effort on the Talo side; the local rows are rejected by the caller.
 */
export async function killLiveTaloPayments(
  admin: SupabaseClient,
  bookingId: string,
): Promise<void> {
  const { data } = await admin
    .from("payments")
    .select("talo_payment_id")
    .eq("booking_id", bookingId)
    .eq("provider", "talo")
    .eq("status", "pending")
    .not("talo_payment_id", "is", null);
  const soon = new Date(Date.now() + 60_000).toISOString();
  for (const r of (data ?? []) as { talo_payment_id: string }[]) {
    await setTaloExpiration(r.talo_payment_id, soon);
  }
}
