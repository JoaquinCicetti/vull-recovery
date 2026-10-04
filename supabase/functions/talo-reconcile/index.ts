// Cron-driven reconciliation of Talo payments. Auth via its own ?token= secret,
// FAIL CLOSED — same pattern as calendar-poll.
//
// Why this exists: Talo's webhook retry policy is undocumented, so a
// webhook-only design has exactly ONE delivery channel. If a transient failure
// eats a notification, the money is in the account and the turno is never
// confirmed — silently, forever. This sweep re-checks every unsettled Talo
// payment against Talo's API and runs the IDENTICAL settle path, which turns the
// webhook into a latency optimization rather than a correctness dependency.
//
// Point an external cron at:
//   POST {SUPABASE_URL}/functions/v1/talo-reconcile?token=$TALO_RECONCILE_TOKEN
// every ~10 minutes.
import { json, errMessage } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";
import { settleTaloPayment } from "../_shared/talo-settle.ts";

// How far back to look. A CVU cannot outlive this, so anything older is settled
// or abandoned for good.
const WINDOW_DAYS = 7;
const BATCH = 100;

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const secret = Deno.env.get("TALO_RECONCILE_TOKEN");
    if (!secret || url.searchParams.get("token") !== secret) {
      return json({ error: "unauthorized" }, 401);
    }

    const admin = adminClient();
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

    // `rejected` is included on purpose: a payment we expired for lack of funds
    // can still receive a late transfer, and settleTaloPayment re-evaluates it
    // (only `approved` short-circuits).
    const { data: rows, error } = await admin
      .from("payments")
      .select("talo_payment_id")
      .eq("provider", "talo")
      .in("status", ["pending", "rejected"])
      .not("talo_payment_id", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(BATCH);
    if (error) return json({ error: error.message }, 500);

    const results: Record<string, number> = {};
    for (const row of rows ?? []) {
      const id = (row as { talo_payment_id: string }).talo_payment_id;
      // Sequential on purpose: this runs on a cron with no deadline, and a burst
      // of parallel calls is exactly how a shared token gets rate-limited.
      const out = await settleTaloPayment(admin, id);
      results[out.result] = (results[out.result] ?? 0) + 1;
    }

    return json({ ok: true, checked: rows?.length ?? 0, results });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
