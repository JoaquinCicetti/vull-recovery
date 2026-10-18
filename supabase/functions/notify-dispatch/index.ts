// Cron-driven sender of the notifications outbox (ADR 0013). Auth via its own
// ?token= secret, FAIL CLOSED — same pattern as talo-reconcile.
//
// Every function that queues a notice also sends it right away (kick() after
// the response, or an awaited dispatch in webhooks and crons), so this is the
// safety net: a send the edge runtime cut short, a Resend outage, a row an
// admin put back with "Reintentar". It never decides anything; claim leases
// keep it from racing a kick for the same row.
//
// Point an external cron at, every ~5 minutes:
//   POST {SUPABASE_URL}/functions/v1/notify-dispatch?token=$NOTIFY_DISPATCH_TOKEN
import { json, errMessage } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";
import { dispatch } from "../_shared/notify.ts";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const secret = Deno.env.get("NOTIFY_DISPATCH_TOKEN");
    if (!secret || url.searchParams.get("token") !== secret) {
      return json({ error: "unauthorized" }, 401);
    }
    const out = await dispatch(adminClient());
    return json({ ok: true, ...out });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
