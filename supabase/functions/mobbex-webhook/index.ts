// Public Edge Function (no Supabase JWT): receives Mobbex IPN webhooks.
// Mobbex has no signature, so we authenticate via a `token` query param that
// we set when creating the checkout's webhook URL. On an approved payment we
// confirm the booking and finalize the Google Calendar event.
import { json, errMessage } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";
import { patchEventStatus } from "../_shared/google.ts";
import { sendBookingConfirmation } from "../_shared/email.ts";

// Mobbex data.payment.status.code → our payment status.
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
    if (secret && url.searchParams.get("token") !== secret) {
      return json({ error: "unauthorized" }, 401);
    }

    const payload = await req.json().catch(() => null);
    const payment = payload?.data?.payment;
    const reference: string | undefined =
      payment?.reference ?? payload?.data?.checkout?.reference;
    const code = Number(payment?.status?.code);

    // Non-payment pings (or malformed) — acknowledge and ignore.
    if (!reference || Number.isNaN(code)) return json({ ok: true });

    const admin = adminClient();
    const status = mapStatus(code);

    const { data: pay } = await admin
      .from("payments")
      .select("id, status")
      .eq("external_reference", reference)
      .eq("provider", "mobbex")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pay) {
      if (pay.status === "approved") return json({ ok: true }); // idempotent
      await admin
        .from("payments")
        .update({ status, raw: payload })
        .eq("id", pay.id);
    } else {
      await admin.from("payments").insert({
        booking_id: reference,
        provider: "mobbex",
        amount_ars: Math.round(Number(payment?.total ?? 0)),
        status,
        external_reference: reference,
        raw: payload,
      });
    }

    if (status === "approved") {
      const { data: booking } = await admin
        .from("bookings")
        .select("id, google_event_id, status")
        .eq("id", reference)
        .single();

      if (booking && booking.status !== "confirmed") {
        await admin
          .from("bookings")
          .update({ status: "confirmed", hold_expires_at: null })
          .eq("id", reference);
        if (booking.google_event_id) {
          try {
            await patchEventStatus(booking.google_event_id, "confirmed");
          } catch (_) {
            /* calendar best-effort */
          }
        }
        // Email the confirmation receipt (best-effort; no-ops if email unset).
        await sendBookingConfirmation(admin, reference);
      }
    }

    return json({ ok: true });
  } catch (e) {
    // Non-2xx → Mobbex will retry, which is what we want for transient errors.
    return json({ error: errMessage(e) }, 500);
  }
});
