// Public Edge Function (no Supabase JWT): receives Mobbex IPN webhooks.
//
// Mobbex sends no signature, so this endpoint is hardened in three layers:
//   1. Fail CLOSED on a shared `token` query param — if MOBBEX_WEBHOOK_SECRET is
//      unset the request is rejected (it used to be skipped, leaving the endpoint
//      wide open).
//   2. Never trust the body's status/amount to confirm: we re-query Mobbex's API
//      for the authoritative status of our own reference (getOperationByReference).
//      The IPN body is only used to find which of OUR payment rows to act on.
//   3. Confirm only when the verified amount matches the booking's service price,
//      and only ever UPDATE a payment row we created in create-payment — never
//      INSERT one from attacker-controlled input.
import { json, errMessage } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";
import { getOperationByReference } from "../_shared/mobbex.ts";
import { patchEventStatus } from "../_shared/google.ts";
import { sendBookingConfirmation } from "../_shared/email.ts";

// Mobbex status code → our payment status.
// 200 = approved; 0/cancelled or >=400 = rejected; everything else = pending.
function mapStatus(code: number): "approved" | "rejected" | "pending" {
  if (code === 200) return "approved";
  if (code === 0 || code >= 400) return "rejected";
  return "pending";
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const secret = Deno.env.get("MOBBEX_WEBHOOK_SECRET");
    // Fail CLOSED: a missing secret must NOT bypass auth (it used to).
    if (!secret || url.searchParams.get("token") !== secret) {
      return json({ error: "unauthorized" }, 401);
    }

    const payload = await req.json().catch(() => null);
    const reference: string | undefined =
      payload?.data?.payment?.reference ?? payload?.data?.checkout?.reference;

    // Non-payment pings (or malformed) — acknowledge and ignore.
    if (!reference) return json({ ok: true });

    const admin = adminClient();

    // Only ever act on a payment row WE created in create-payment. An unknown
    // reference is ignored — we never INSERT a payment from webhook input.
    const { data: pay } = await admin
      .from("payments")
      .select("id, status, booking_id")
      .eq("external_reference", reference)
      .eq("provider", "mobbex")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!pay) return json({ ok: true });
    if (pay.status === "approved") return json({ ok: true }); // idempotent

    // Do NOT trust the body's status/amount. Re-query Mobbex for the truth; if the
    // API isn't configured or can't be parsed, fall back to the (token-gated) body.
    const verified = await getOperationByReference(reference);
    const code = verified.ok
      ? verified.code
      : Number(payload?.data?.payment?.status?.code);
    const totalRaw = verified.ok
      ? verified.total
      : Number(payload?.data?.payment?.total);
    const verifiedTotal =
      totalRaw == null || Number.isNaN(totalRaw) ? null : totalRaw;

    if (Number.isNaN(code)) return json({ ok: true });
    let status = mapStatus(code);

    // For an approved payment, the amount must match the real service price
    // before we confirm — otherwise hold it for admin review.
    let amountMismatch = false;
    let booking:
      | { id: string; google_event_id: string | null; status: string; services: { price_ars: number } | null }
      | null = null;

    if (status === "approved") {
      const { data: b } = await admin
        .from("bookings")
        .select("id, google_event_id, status, services(price_ars)")
        .eq("id", pay.booking_id)
        .single();
      // deno-lint-ignore no-explicit-any
      booking = b as any;
      const expected = booking?.services?.price_ars ?? null;
      if (expected != null && verifiedTotal != null && Math.round(verifiedTotal) !== expected) {
        amountMismatch = true;
        status = "pending"; // do not auto-confirm a mismatched amount
      }
    }

    await admin
      .from("payments")
      .update({ status, raw: payload })
      .eq("id", pay.id);

    if (amountMismatch) return json({ ok: true, mismatch: true });

    if (status === "approved" && booking && booking.status !== "confirmed") {
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
    // Non-2xx → Mobbex will retry, which is what we want for transient errors.
    return json({ error: errMessage(e) }, 500);
  }
});
