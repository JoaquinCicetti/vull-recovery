// Public Edge Function: WhatsApp Cloud API webhook.
//   GET  → Meta verification handshake (hub.challenge).
//   POST → log inbound messages. A client messaging us first opens the free
//          24h reply window; we record window_expires_at to track it.
// This is the optional Cloud API layer; the wa.me click-to-chat flow works
// without it. No proactive (paid) templates are ever sent here.
import { json, errMessage } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ── Verification handshake ──────────────────────────────────────────────
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === Deno.env.get("WHATSAPP_VERIFY_TOKEN")) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  // ── Inbound messages ──────────────────────────────────────────────────────
  try {
    const payload = await req.json().catch(() => null);
    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const messages = value?.messages ?? [];

    if (messages.length) {
      const admin = adminClient();
      for (const m of messages) {
        const phone = String(m.from ?? "");
        const body = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? "(mensaje)";
        // WhatsApp's `from` is the full number in digits (e.g. 5491122334455).
        // Profiles store the number normalized to digits, so match exactly.
        const digits = phone.replace(/\D/g, "");
        const { data: profile } = digits
          ? await admin
              .from("profiles")
              .select("id")
              .eq("whatsapp_phone", digits)
              .maybeSingle()
          : { data: null };

        await admin.from("whatsapp_messages").insert({
          profile_id: profile?.id ?? null,
          phone,
          direction: "inbound",
          body,
          wa_message_id: m.id ?? null,
          window_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        });
      }
    }

    return json({ ok: true });
  } catch (e) {
    // Always 200 to Meta so it doesn't disable the webhook on transient errors.
    return json({ error: errMessage(e) }, 200);
  }
});
