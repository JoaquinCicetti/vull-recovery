// Public Edge Function: a trivial DB ping to keep the free-tier Supabase
// project from pausing after ~7 days of inactivity.
// Schedule a weekly GET from an external cron (e.g. cron-job.org or a GitHub
// Actions workflow) against this function's URL.
import { adminClient } from "../_shared/supabase.ts";

Deno.serve(async () => {
  try {
    await adminClient().from("settings").select("id").limit(1);
    return new Response("ok", { status: 200 });
  } catch {
    return new Response("error", { status: 500 });
  }
});
