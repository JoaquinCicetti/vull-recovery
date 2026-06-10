// Transactional email via Gmail SMTP. No-ops if GMAIL_USER / GMAIL_APP_PASSWORD
// are unset, so the booking flow keeps working without email configured.
// GMAIL_APP_PASSWORD is a Google "App Password" (account needs 2FA enabled).
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

async function sendMail(
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  const user = Deno.env.get("GMAIL_USER");
  const pass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!user || !pass || !to) return false;

  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: user, password: pass },
    },
  });
  try {
    await client.send({ from: `VULL <${user}>`, to, subject, html });
    return true;
  } finally {
    await client.close();
  }
}

const money = (ars: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(ars);

// Sends the "turno confirmado" receipt. Best-effort: any failure (including
// email not configured) is swallowed so it never breaks payment confirmation.
export async function sendBookingConfirmation(
  admin: SupabaseClient,
  bookingId: string,
): Promise<void> {
  try {
    const { data: b } = await admin
      .from("bookings")
      .select("id, user_id, starts_at, services(name, price_ars)")
      .eq("id", bookingId)
      .single();
    if (!b) return;

    const { data: u } = await admin.auth.admin.getUserById(b.user_id);
    const email = u?.user?.email;
    if (!email) return;

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", b.user_id)
      .single();
    const { data: settings } = await admin
      .from("settings")
      .select("timezone")
      .eq("id", true)
      .single();

    const tz = settings?.timezone ?? "America/Argentina/Buenos_Aires";
    // deno-lint-ignore no-explicit-any
    const svc = (b.services as any)?.name ?? "Sesión";
    // deno-lint-ignore no-explicit-any
    const price = (b.services as any)?.price_ars ?? 0;
    const firstName = (profile?.full_name ?? "").split(" ")[0] || "Hola";
    const ref = b.id.slice(0, 8).toUpperCase();
    const appUrl = Deno.env.get("APP_URL") ?? "";

    const when = new Intl.DateTimeFormat("es-AR", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(b.starts_at));

    const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#111">
  <h2 style="margin:0 0 4px">Turno confirmado ✓</h2>
  <p style="color:#555;margin:0 0 20px">Hola ${firstName}, tu pago fue acreditado.</p>
  <table style="width:100%;border-collapse:collapse;font-size:15px">
    <tr><td style="padding:8px 0;color:#777">Servicio</td><td style="padding:8px 0;text-align:right;font-weight:600">${svc}</td></tr>
    <tr><td style="padding:8px 0;color:#777;border-top:1px solid #eee">Fecha y hora</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #eee;text-transform:capitalize">${when}</td></tr>
    <tr><td style="padding:8px 0;color:#777;border-top:1px solid #eee">Pagado</td><td style="padding:8px 0;text-align:right;font-weight:600;border-top:1px solid #eee">${money(price)}</td></tr>
    <tr><td style="padding:8px 0;color:#777;border-top:1px solid #eee">Comprobante</td><td style="padding:8px 0;text-align:right;font-family:monospace;border-top:1px solid #eee">${ref}</td></tr>
  </table>
  <p style="margin:20px 0 4px;font-weight:600">Antes de tu turno</p>
  <p style="color:#555;margin:0 0 16px">Escribinos por WhatsApp con tu nombre así coordinamos los últimos detalles. Si no, mostrá este email (comprobante <strong>${ref}</strong>) al llegar.</p>
  ${appUrl ? `<a href="${appUrl}/turno/${b.id}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Ver mi turno</a>` : ""}
  <p style="color:#999;font-size:12px;margin-top:28px">VULL · Recuperación deportiva</p>
</div>`;

    await sendMail(email, `Turno confirmado · VULL (${ref})`, html);
  } catch (_) {
    // Best-effort — never break the confirmation flow on an email error.
  }
}
