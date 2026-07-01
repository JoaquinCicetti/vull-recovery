// Authenticated Edge Function. Pays either a booking or a pack purchase:
//   { booking_id }      → pay for a booking (mobbex checkout or manual receipt);
//                         the booking moves to `awaiting_payment`.
//   { pack_service_id } → buy a multi-session pack (no booking). On approval the
//                         mobbex-webhook / admin-payment grants the credits.
// method "mobbex" returns the hosted pay URL; "manual" records a receipt for
// admin review. Amount is always taken server-side from the services row.
import { responder, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";

async function mobbexCheckout(opts: {
  amount: number;
  reference: string;
  description: string;
  email?: string;
  name?: string;
  returnUrl: string;
}) {
  const apiKey = Deno.env.get("MOBBEX_API_KEY");
  const accessToken = Deno.env.get("MOBBEX_ACCESS_TOKEN");
  if (!apiKey || !accessToken) return { error: "unconfigured" as const };
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const secret = Deno.env.get("MOBBEX_WEBHOOK_SECRET") ?? "";
  const webhookUrl = `${supabaseUrl}/functions/v1/mobbex-webhook${
    secret ? `?token=${encodeURIComponent(secret)}` : ""
  }`;
  const res = await fetch("https://api.mobbex.com/p/checkout", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "x-access-token": accessToken,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      total: opts.amount,
      currency: "ARS",
      reference: opts.reference,
      description: opts.description,
      customer: { email: opts.email, name: opts.name ?? opts.email },
      return_url: opts.returnUrl,
      webhook: webhookUrl,
      test: (Deno.env.get("MOBBEX_TEST") ?? "false") === "true",
    }),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok || !out?.data?.url) return { error: "checkout_failed" as const, detail: out };
  return { url: out.data.url as string, id: out.data.id as string };
}

Deno.serve(async (req) => {
  const { json, options } = responder(req);
  if (req.method === "OPTIONS") return options();
  try {
    const { booking_id, pack_service_id, method = "mobbex", receipt_path } =
      await req.json();
    if (!booking_id && !pack_service_id) {
      return json({ error: "Falta booking_id o pack_service_id" }, 400);
    }

    const {
      data: { user },
    } = await userClient(req).auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);

    const admin = adminClient();
    const appUrl = Deno.env.get("APP_URL") ?? "http://localhost:3000";

    // ══ PACK PURCHASE (no booking) ═══════════════════════════════════════════
    if (pack_service_id) {
      const { data: pack } = await admin
        .from("services")
        .select("id, name, price_ars, active, grants_service_id")
        .eq("id", pack_service_id)
        .single();
      if (!pack || !pack.active || !pack.grants_service_id) {
        return json({ error: "Pack no disponible" }, 404);
      }
      const amount: number = pack.price_ars ?? 0;

      if (method === "manual") {
        if (!receipt_path || !String(receipt_path).startsWith(`${user.id}/`)) {
          return json({ error: "Comprobante inválido" }, 400);
        }
        await admin.from("payments").insert({
          kind: "pack",
          service_id: pack.id,
          user_id: user.id,
          provider: "manual",
          amount_ars: amount,
          status: "pending",
          receipt_path,
        });
        return json({ ok: true });
      }

      // Mobbex: create the pack payment row first so its id is the reference.
      const { data: pay, error: payErr } = await admin
        .from("payments")
        .insert({
          kind: "pack",
          service_id: pack.id,
          user_id: user.id,
          provider: "mobbex",
          amount_ars: amount,
          status: "pending",
        })
        .select("id")
        .single();
      if (payErr || !pay) return json({ error: "No se pudo iniciar el pago" }, 500);

      const { data: profile } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .single();
      const co = await mobbexCheckout({
        amount,
        reference: pay.id,
        description: `${pack.name}`,
        email: user.email,
        name: profile?.full_name ?? undefined,
        returnUrl: `${appUrl}/comprar/exito?ref=${pay.id}`,
      });
      if ("error" in co) {
        return json(
          { error: co.error === "unconfigured" ? "Pagos online no configurados" : "No se pudo iniciar el pago" },
          co.error === "unconfigured" ? 503 : 502,
        );
      }
      await admin
        .from("payments")
        .update({ mobbex_checkout_id: co.id, external_reference: pay.id })
        .eq("id", pay.id);
      return json({ url: co.url, checkout_id: co.id });
    }

    // ══ BOOKING PAYMENT ══════════════════════════════════════════════════════
    const { data: booking } = await admin
      .from("bookings")
      .select("*, services(name, price_ars)")
      .eq("id", booking_id)
      .single();

    if (!booking) return json({ error: "Reserva no encontrada" }, 404);
    if (booking.user_id !== user.id) return json({ error: "No autorizado" }, 403);
    if (!["pending", "awaiting_payment"].includes(booking.status)) {
      return json({ error: "La reserva no admite pago" }, 409);
    }

    const amount: number = booking.services?.price_ars ?? 0;

    if (method === "manual") {
      if (!receipt_path || !String(receipt_path).startsWith(`${user.id}/`)) {
        return json({ error: "Comprobante inválido" }, 400);
      }
      await admin.from("payments").insert({
        booking_id,
        provider: "manual",
        amount_ars: amount,
        status: "pending",
        receipt_path,
        external_reference: booking_id,
      });
      await admin
        .from("bookings")
        .update({ status: "awaiting_payment" })
        .eq("id", booking_id);
      return json({ ok: true });
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single();
    const co = await mobbexCheckout({
      amount,
      reference: booking_id,
      description: `${booking.services?.name ?? "Turno"} — ${booking_id.slice(0, 8)}`,
      email: user.email,
      name: profile?.full_name ?? undefined,
      returnUrl: `${appUrl}/turno/${booking_id}`,
    });
    if ("error" in co) {
      return json(
        { error: co.error === "unconfigured" ? "Pagos online no configurados" : "No se pudo iniciar el pago", detail: co.detail },
        co.error === "unconfigured" ? 503 : 502,
      );
    }

    // Track the checkout (one mobbex payment row per booking).
    const { data: existing } = await admin
      .from("payments")
      .select("id")
      .eq("booking_id", booking_id)
      .eq("provider", "mobbex")
      .maybeSingle();

    if (existing) {
      await admin
        .from("payments")
        .update({ mobbex_checkout_id: co.id, amount_ars: amount, status: "pending" })
        .eq("id", existing.id);
    } else {
      await admin.from("payments").insert({
        booking_id,
        provider: "mobbex",
        amount_ars: amount,
        status: "pending",
        mobbex_checkout_id: co.id,
        external_reference: booking_id,
      });
    }

    await admin
      .from("bookings")
      .update({ status: "awaiting_payment" })
      .eq("id", booking_id);

    return json({ url: co.url, checkout_id: co.id });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
