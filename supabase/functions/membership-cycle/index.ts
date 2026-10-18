// Cron-driven maintenance for abonos. Auth via its own ?token= secret, FAIL
// CLOSED — same pattern as talo-reconcile.
//
// Nothing depends on it: every membership/booking function runs the same
// housekeeping() lazily. It exists so a quiet day still rolls recurring
// members into the next month and an admin hears about a member whose bed was
// taken next month (roll_memberships queues one admin_alert per member and
// month; this sends it, ADR 0013).
//
// Point an external cron at, once a day:
//   POST {SUPABASE_URL}/functions/v1/membership-cycle?token=$MEMBERSHIP_CYCLE_TOKEN
import { json, errMessage } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";
import { dispatch } from "../_shared/notify.ts";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const secret = Deno.env.get("MEMBERSHIP_CYCLE_TOKEN");
    if (!secret || url.searchParams.get("token") !== secret) {
      return json({ error: "unauthorized" }, 401);
    }
    const admin = adminClient();
    const { data: result, error } = await admin.rpc("housekeeping");
    if (error) return json({ error: error.message }, 500);

    const { count } = await admin
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .not("roll_error", "is", null);
    const notified = await dispatch(admin).catch((e) => {
      console.error("[notify] dispatch failed", e);
      return null;
    });
    return json({ ok: true, result, roll_errors: count ?? 0, notified });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
