// Public Edge Function (no Supabase JWT): receives Talo payment notifications.
//
// Talo sends NO signature today (the docs promise an X-Talo-Signature HMAC
// "pronto") and the body is deliberately minimal — `{message, paymentId}`, with
// no status and no amount. So this endpoint is hardened by shape, not by trust:
//
//   1. A shared `?token=` secret, FAIL CLOSED: no TALO_WEBHOOK_SECRET, no entry.
//      Compared over SHA-256 digests with a timing-safe primitive, so neither the
//      length nor a prefix of the secret leaks through response timing.
//   2. The body is used ONLY to name which paymentId to go and check. Every fact
//      about money comes from an authenticated GET /payments/{id} inside
//      talo-settle. There is deliberately NO fall-back-to-the-body branch.
//   3. Only ever UPDATEs a payment row create-payment already created.
//
// Read (1) honestly: because we never trust the body, the token is a RATE-LIMIT
// gate, not the authority. A leaked token buys an attacker nothing but the
// ability to make us re-check our own payment ids against Talo. Do not "improve"
// this by trusting the body when the token matches.
//
// Note the token travels in the query string (Talo accepts only a URL), so it
// lands in Supabase's function logs: give it a secret used nowhere else.
import { json, errMessage } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";
import { settleTaloPayment } from "../_shared/talo-settle.ts";
import { timingSafeEqual } from "jsr:@std/crypto@1/timing-safe-equal";

async function sha256(s: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return new Uint8Array(buf);
}

async function tokenOk(given: string | null): Promise<boolean> {
  const secret = Deno.env.get("TALO_WEBHOOK_SECRET");
  // Fail CLOSED: a missing secret must never mean "let everyone in".
  if (!secret || !given) return false;
  // Digest both sides first so the comparison is over two fixed-length buffers.
  const [a, b] = await Promise.all([sha256(given), sha256(secret)]);
  return timingSafeEqual(a, b);
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (!(await tokenOk(url.searchParams.get("token")))) {
      return json({ error: "unauthorized" }, 401);
    }

    const payload = await req.json().catch(() => null);
    const paymentId = payload?.paymentId ?? payload?.payment_id ?? payload?.id;
    // Non-payment pings (or malformed) — acknowledge and ignore.
    if (!paymentId) return json({ ok: true });

    const out = await settleTaloPayment(adminClient(), paymentId);
    // 5xx invites Talo to retry, which is what we want for a transient failure.
    return json({ ok: out.status < 400, result: out.result }, out.status);
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
