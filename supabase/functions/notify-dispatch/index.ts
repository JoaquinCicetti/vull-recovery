// Sender of the notifications outbox (ADR 0013). Two callers, either is enough:
//   - the external cron, with its own ?token= secret, FAIL CLOSED (same pattern
//     as talo-reconcile);
//   - an admin from /admin "Reintentar" (Avisos no enviados), with their JWT.
//     verify_jwt is off for the cron, so the Authorization header is checked
//     here (isAdminUser, like the other admin functions).
//
// Every function that queues a notice also sends it right away (kick() after
// the response, or an awaited dispatch in crons), so this is the safety net: a
// send the edge runtime cut short, a Resend outage, a row an admin put back
// with "Reintentar". It never decides anything; claim leases keep it from
// racing a kick for the same row.
//
// Point an external cron at, every ~5 minutes:
//   POST {SUPABASE_URL}/functions/v1/notify-dispatch?token=$NOTIFY_DISPATCH_TOKEN
import { responder, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";
import { isAdminUser } from "../_shared/sector.ts";
import { dispatch } from "../_shared/notify.ts";

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
  try {
    const admin = adminClient();
    const url = new URL(req.url);
    const secret = Deno.env.get("NOTIFY_DISPATCH_TOKEN");
    const token = url.searchParams.get("token");
    const byCron = Boolean(secret) && token === secret;
    if (!byCron) {
      // No (valid) token: only a signed-in admin. No Authorization header
      // means no user, so this still fails closed.
      const user = req.headers.get("Authorization")
        ? (await userClient(req).auth.getUser()).data.user
        : null;
      if (!(await isAdminUser(admin, user))) return json({ error: "unauthorized" }, 401);
    }
    const out = await dispatch(admin);
    return json({ ok: true, ...out });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
