// Authenticated Edge Function. Two modes for paying a booking:
//   method "mobbex" → creates a Mobbex checkout, returns the hosted pay URL.
//   method "manual" → records an uploaded transfer receipt for admin review.
// In both cases the booking moves to `awaiting_payment`.
import { json, handleOptions, errMessage } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions();
  try {
    const { booking_id, method = "mobbex", receipt_path } = await req.json();
    if (!booking_id) return json({ error: "booking_id requerido" }, 400);

    const {
      data: { user },
    } = await userClient(req).auth.getUser();
    if (!user) return json({ error: "No autenticado" }, 401);

    const admin = adminClient();
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

    // ── Manual transfer: record the receipt for admin verification ──────────
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

    // ── Mobbex checkout ─────────────────────────────────────────────────────
    const apiKey = Deno.env.get("MOBBEX_API_KEY");
    const accessToken = Deno.env.get("MOBBEX_ACCESS_TOKEN");
    if (!apiKey || !accessToken) {
      return json({ error: "Pagos online no configurados" }, 503);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const appUrl = Deno.env.get("APP_URL") ?? "http://localhost:3000";
    const secret = Deno.env.get("MOBBEX_WEBHOOK_SECRET") ?? "";
    const webhookUrl = `${supabaseUrl}/functions/v1/mobbex-webhook${
      secret ? `?token=${encodeURIComponent(secret)}` : ""
    }`;

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single();

    const res = await fetch("https://api.mobbex.com/p/checkout", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "x-access-token": accessToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        total: amount,
        currency: "ARS",
        reference: booking_id, // echoed back in the webhook
        description: `${booking.services?.name ?? "Turno"} — ${booking_id.slice(0, 8)}`,
        customer: { email: user.email, name: profile?.full_name ?? user.email },
        return_url: `${appUrl}/turno/${booking_id}`,
        webhook: webhookUrl,
        test: (Deno.env.get("MOBBEX_TEST") ?? "false") === "true",
      }),
    });

    const out = await res.json().catch(() => null);
    if (!res.ok || !out?.data?.url) {
      return json({ error: "No se pudo iniciar el pago", detail: out }, 502);
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
        .update({
          mobbex_checkout_id: out.data.id,
          amount_ars: amount,
          status: "pending",
        })
        .eq("id", existing.id);
    } else {
      await admin.from("payments").insert({
        booking_id,
        provider: "mobbex",
        amount_ars: amount,
        status: "pending",
        mobbex_checkout_id: out.data.id,
        external_reference: booking_id,
      });
    }

    await admin
      .from("bookings")
      .update({ status: "awaiting_payment" })
      .eq("id", booking_id);

    return json({ url: out.data.url, checkout_id: out.data.id });
  } catch (e) {
    return json({ error: errMessage(e) }, 500);
  }
});
