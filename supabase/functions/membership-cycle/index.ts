// Cron-driven maintenance for abonos. Auth via its own ?token= secret, FAIL
// CLOSED — same pattern as talo-reconcile.
//
// Nothing depends on it: every membership/booking function runs the same
// housekeeping() lazily. It exists so a quiet day still rolls recurring
// members into the next month and an admin hears about a member whose bed was
// taken next month (memberships.roll_error).
//
// Point an external cron at, once a day:
//   POST {SUPABASE_URL}/functions/v1/membership-cycle?token=$MEMBERSHIP_CYCLE_TOKEN
import { json, errMessage } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";
import { notifyAdminsSimple } from "../_shared/email.ts";

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

    const { data: broken } = await admin
      .from("memberships")
      .select("id, profiles!memberships_user_id_fkey(full_name), services(name)")
      .eq("status", "active")
      .not("roll_error", "is", null)
      .limit(20);
    if (broken && broken.length > 0) {
      // deno-lint-ignore no-explicit-any
      const names = (broken as any[])
        .map((m) => `${m.profiles?.full_name ?? "Cliente"} (${m.services?.name ?? "abono"})`)
        .join(", ");
      await notifyAdminsSimple(
        admin,
        "Abonos sin lugar el mes que viene",
        `A ${names} les tomaron una cama del mes próximo y su abono no se pudo renovar. Reprogramá el turno que la ocupa o cambiales la cama desde Abonos.`,
      );
    }
    return json({ ok: true, result, roll_errors: broken?.length ?? 0 });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
