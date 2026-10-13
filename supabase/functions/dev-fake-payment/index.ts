// Authenticated, DEV-ONLY Edge Function: fake the client's bank transfer for
// a pending Talo payment, so the whole flow can be followed end to end.
//
// It only asks Talo's SANDBOX faucet to send the money to the payment's CVU.
// Nothing here touches the payment or booking: Talo fires the real webhook,
// and talo-webhook → talo-settle confirm the turno exactly as in production.
//
// Fail closed twice: DEV_MODE must be "true" AND Talo must be in sandbox
// (TALO_TEST=true) — taloFaucet refuses otherwise. Ownership is enforced by
// reading the row with the CALLER's client, so RLS (payments_select_own)
// decides whose CVU can be funded.
//
// Body: { cvu, amount? } — amount defaults to the exact price; pass another
// value to exercise the underpay/overpay paths.
import { responder, errMessage } from "../_shared/cors.ts";
import { userClient } from "../_shared/supabase.ts";
import { taloFaucet } from "../_shared/talo.ts";

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
  try {
    if (Deno.env.get("DEV_MODE") !== "true") {
      return json({ error: "Solo disponible en modo dev" }, 404);
    }

    const client = userClient(req);
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);

    const { cvu, amount } = await req.json().catch(() => ({}));
    if (typeof cvu !== "string" || !cvu) {
      return json({ error: "Datos inválidos" }, 400);
    }
    if (amount !== undefined && !(Number.isFinite(amount) && amount > 0)) {
      return json({ error: "Monto inválido" }, 400);
    }

    const { data: pay } = await client
      .from("payments")
      .select("id, amount_ars")
      .eq("provider", "talo")
      .eq("status", "pending")
      .eq("talo_cvu", cvu)
      .maybeSingle();
    if (!pay) return json({ error: "Pago no encontrado" }, 404);

    const sent = amount ?? pay.amount_ars;
    const res = await taloFaucet(cvu, sent);
    if (!res.ok) {
      return json({ error: `Talo faucet: ${res.reason}` }, res.reason === "not_sandbox" ? 409 : 502);
    }
    return json({ ok: true, payment_id: pay.id, amount: sent });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
