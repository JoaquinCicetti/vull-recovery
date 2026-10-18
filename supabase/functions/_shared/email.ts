// Transactional email via the Resend HTTP API (or, in local dev only, the
// EMAIL_SINK_URL Mailpit sink). No-ops if RESEND_API_KEY / EMAIL_FROM are
// unset, so the booking flow keeps working without email configured.
// EMAIL_FROM must be a sender on the Resend-verified domain,
// e.g. `VULL <hola@vull.com.ar>`.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendPush, type PushSub } from "./webpush.ts";
import { SESSION_BRIEFING } from "./session-briefing.ts";
import {
  ADDRESS_LINE,
  CONTACT_PHONE_DISPLAY,
  INSTAGRAM_HANDLE,
  INSTAGRAM_URL,
  waUrl,
} from "./site.ts";

export async function sendMail(
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");

  // DEV ONLY: with EMAIL_SINK_URL set (local supabase/functions/.env, never a
  // deployed secret), mail goes to Mailpit's send API instead of Resend, e.g.
  // http://host.docker.internal:54324/api/v1/send. See docs/setup.md.
  const sink = Deno.env.get("EMAIL_SINK_URL");
  if (sink) {
    if (!to) return false;
    const res = await fetch(sink, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: { Email: from ?? "dev@vull.local" },
        To: [{ Email: to }],
        Subject: subject,
        HTML: html,
      }),
    });
    return res.ok;
  }

  if (!apiKey || !from || !to) return false;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  return res.ok;
}

export const money = (ars: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(ars);

// ─── VULL-branded email shell ───────────────────────────────────────────────
// Matte black + green accent, mono for "instrument" data (matches the app and
// the OTP email). Inline styles + tables for email-client compatibility.
export type Row = { label: string; value: string; mono?: boolean };
/** A titled checklist under the rows (e.g. the pre-session briefing). */
export type Section = {
  title: string;
  lead?: string;
  items: string[];
  tone?: "ok" | "warn"; // ok: green checks; warn: amber title, muted bullets
  footer?: string;
};
type Shell = {
  heading: string;
  lead: string;
  rows?: Row[];
  sections?: Section[];
  note?: string;
  cta?: { label: string; url: string };
  accent?: string; // heading tint (defaults to fg)
};

const FONT = "font-family:Arial,Helvetica,sans-serif;";

function sectionHtml(sec: Section): string {
  const warn = sec.tone === "warn";
  const items = sec.items
    .map(
      (it) => `
        <tr>
          <td valign="top" style="width:22px; padding:5px 0; ${FONT} font-size:14px; line-height:1.5; ${warn ? "color:#7d7d7d;" : "color:#61b33b; font-weight:700;"}">${warn ? "&#9642;" : "&#10003;"}</td>
          <td style="padding:5px 0; ${FONT} font-size:14px; line-height:1.5; color:#bdbdbd;">${it}</td>
        </tr>`,
    )
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px; border-top:1px solid #262626;">
      <tr><td style="padding-top:20px;">
        <p style="margin:0 0 8px; ${FONT} font-size:11px; font-weight:700; letter-spacing:0.18em; text-transform:uppercase; color:${warn ? "#e5a33b" : "#61b33b"};">${sec.title}</p>
        ${sec.lead ? `<p style="margin:0 0 8px; ${FONT} font-size:14px; line-height:1.5; color:#bdbdbd;">${sec.lead}</p>` : ""}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items}</table>
        ${sec.footer ? `<p style="margin:10px 0 0; ${FONT} font-size:13px; line-height:1.5; color:#7d7d7d;">${sec.footer}</p>` : ""}
      </td></tr>
    </table>`;
}

export function shell({ heading, lead, rows = [], sections = [], note, cta, accent }: Shell): string {
  const rowsHtml = rows
    .map(
      (r, i) => `
      <tr>
        <td style="padding:10px 0;${i ? "border-top:1px solid #262626;" : ""}font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#7d7d7d">${r.label}</td>
        <td style="padding:10px 0;${i ? "border-top:1px solid #262626;" : ""}text-align:right;font-size:14px;font-weight:600;color:#f4f4f4;${r.mono ? "font-family:'Courier New',Courier,monospace;" : "font-family:Arial,Helvetica,sans-serif;"}">${r.value}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="es">
  <body style="margin:0; padding:0; background-color:#000000;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#000000;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:460px; width:100%;">
            <tr>
              <td style="padding-bottom:24px;">
                <span style="font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:700; letter-spacing:0.22em; text-transform:uppercase; color:#61b33b;">VULL</span>
              </td>
            </tr>
            <tr>
              <td style="background-color:#0d0d0d; border:1px solid #262626; border-radius:12px; padding:32px;">
                <h1 style="margin:0 0 6px; font-family:Arial,Helvetica,sans-serif; font-size:20px; font-weight:700; color:${accent ?? "#f4f4f4"};">${heading}</h1>
                <p style="margin:0 0 ${rows.length ? "24px" : "8px"}; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.5; color:#bdbdbd;">${lead}</p>
                ${
                  rows.length
                    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}</table>`
                    : ""
                }
                ${sections.map(sectionHtml).join("")}
                ${
                  note
                    ? `<p style="margin:24px 0 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:1.5; color:#7d7d7d;">${note}</p>`
                    : ""
                }
                ${
                  cta
                    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr><td style="border-radius:8px; background-color:#61b33b;">
                        <a href="${cta.url}" style="display:inline-block; padding:11px 20px; font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:700; color:#0a0f08; text-decoration:none;">${cta.label}</a>
                      </td></tr></table>`
                    : ""
                }
              </td>
            </tr>
            <tr>
              <td style="padding:20px 4px 0;">
                <p style="margin:0; ${FONT} font-size:12px; line-height:1.7; color:#7d7d7d;">
                  ${ADDRESS_LINE}<br />
                  Turnos y consultas: <a href="${waUrl()}" style="color:#bdbdbd; text-decoration:none;">${CONTACT_PHONE_DISPLAY}</a><br />
                  <a href="${INSTAGRAM_URL}" style="color:#bdbdbd; text-decoration:none;">${INSTAGRAM_HANDLE}</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// ─── Shared booking context loader ──────────────────────────────────────────
type BookingEmailCtx = {
  userId: string;
  email: string;
  firstName: string;
  svc: string;
  price: number;
  when: string;
  ref: string;
  appUrl: string;
  bookingId: string;
  /** sectors.slug; gates sector-specific copy (the recovery briefing). */
  sectorSlug: string | null;
};

async function loadBookingCtx(
  admin: SupabaseClient,
  bookingId: string,
): Promise<BookingEmailCtx | null> {
  const { data: b } = await admin
    .from("bookings")
    .select("id, user_id, starts_at, services(name, price_ars), sectors(slug)")
    .eq("id", bookingId)
    .single();
  if (!b) return null;

  const { data: u } = await admin.auth.admin.getUserById(b.user_id);
  const email = u?.user?.email;
  if (!email) return null;

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
  const when = new Intl.DateTimeFormat("es-AR", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(b.starts_at));

  return {
    userId: b.user_id,
    email,
    firstName,
    svc,
    price,
    when,
    ref: b.id.slice(0, 8).toUpperCase(),
    appUrl: Deno.env.get("APP_URL") ?? "",
    bookingId: b.id,
    // deno-lint-ignore no-explicit-any
    sectorSlug: (b.sectors as any)?.slug ?? null,
  };
}

// Fan out a CLIENT notification to one user: email (Resend) + Web Push, each gated
// by that user's own preference (profiles.notify_email / notify_push). Mirror of
// fanOutToAdmins but keyed on a single user_id, and it reads the recipient's email
// from profiles rather than assuming the caller has it. Best-effort throughout.
export async function fanOutToUser(
  admin: SupabaseClient,
  userId: string,
  msg: { subject: string; html: string; push?: { title: string; body: string; url: string } },
): Promise<void> {
  const { data: p } = await admin
    .from("profiles")
    .select("email, notify_email, notify_push")
    .eq("id", userId)
    .single();
  if (!p) return;
  const prefs = p as {
    email: string | null;
    notify_email: boolean;
    notify_push: boolean;
  };

  const jobs: Promise<unknown>[] = [];

  if (prefs.notify_email && prefs.email) {
    jobs.push(sendMail(prefs.email, msg.subject, msg.html));
  }

  if (prefs.notify_push && msg.push) {
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);
    const payload = JSON.stringify(msg.push);
    for (const s of (subs ?? []) as (PushSub & { id: string })[]) {
      jobs.push(
        (async () => {
          const status = await sendPush(
            { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
            payload,
          );
          if (status === 404 || status === 410) {
            await admin.from("push_subscriptions").delete().eq("id", s.id);
          }
        })(),
      );
    }
  }

  await Promise.allSettled(jobs);
}

// All senders are best-effort: any failure (including email not configured) is
// swallowed so it never breaks the booking flow.

/** Acknowledgement when a booking is first created (slot held, payment pending). */
export async function sendBookingReceived(
  admin: SupabaseClient,
  bookingId: string,
): Promise<void> {
  // Email-only ack: with Resend unconfigured, loadBookingCtx + fanOutToUser would
  // still spend 5 DB/Auth reads before sendMail no-ops. Skip the whole thing.
  const mailOn = Deno.env.get("EMAIL_SINK_URL") ||
    (Deno.env.get("RESEND_API_KEY") && Deno.env.get("EMAIL_FROM"));
  if (!mailOn) return;
  try {
    const c = await loadBookingCtx(admin, bookingId);
    if (!c) return;
    const html = shell({
      heading: "Reserva tomada",
      lead: `Hola ${c.firstName}, te guardamos el horario. Falta el pago para confirmar el turno.`,
      rows: [
        { label: "Servicio", value: c.svc },
        { label: "Fecha y hora", value: c.when },
        { label: "Importe", value: money(c.price), mono: true },
        { label: "Reserva", value: c.ref, mono: true },
      ],
      note: "Si no completás el pago, el horario se libera y queda disponible para otra persona.",
      cta: c.appUrl
        ? { label: "Pagar y confirmar", url: `${c.appUrl}/turno/${c.bookingId}` }
        : undefined,
    });
    // Email only: this is a "we're holding your slot, pay to confirm" ack, not one
    // of the alert events push is for.
    await fanOutToUser(admin, c.userId, {
      subject: `Reserva tomada · VULL (${c.ref})`,
      html,
    });
  } catch (_) {
    /* best-effort */
  }
}

/** SESSION_BRIEFING as two email sections: what to bring, then health caveats. */
function briefingSections(): Section[] {
  const b = SESSION_BRIEFING;
  return [
    { title: b.title, lead: b.intro, items: b.bring, tone: "ok", footer: b.facilities },
    {
      title: "Condiciones de salud",
      lead: `${b.healthIntro} ${b.healthLead}`,
      items: b.contraindications,
      tone: "warn",
      footer: b.healthNote,
    },
  ];
}

/** Receipt when payment is accredited and the booking becomes confirmed. */
export async function sendBookingConfirmation(
  admin: SupabaseClient,
  bookingId: string,
): Promise<void> {
  try {
    const c = await loadBookingCtx(admin, bookingId);
    if (!c) return;
    const html = shell({
      heading: "Turno confirmado ✓",
      accent: "#61b33b",
      lead: `Hola ${c.firstName}, tu pago fue acreditado.`,
      rows: [
        { label: "Servicio", value: c.svc },
        { label: "Fecha y hora", value: c.when },
        { label: "Pagado", value: money(c.price), mono: true },
        { label: "Comprobante", value: c.ref, mono: true },
      ],
      // The pre-session briefing describes the recovery circuit; other sectors
      // (pilates abonos use membership-email.ts anyway) don't get it.
      sections: c.sectorSlug === SESSION_BRIEFING.sectorSlug ? briefingSections() : [],
      note: "Escribinos por WhatsApp con tu nombre para coordinar los últimos detalles. Si no, mostrá este email al llegar.",
      cta: c.appUrl
        ? { label: "Ver mi turno", url: `${c.appUrl}/turno/${c.bookingId}` }
        : undefined,
    });
    await fanOutToUser(admin, c.userId, {
      subject: `Turno confirmado · VULL (${c.ref})`,
      html,
      push: {
        title: "Turno confirmado ✓",
        body: `${c.svc} · ${c.when}`,
        url: `${c.appUrl}/turno/${c.bookingId}`,
      },
    });
  } catch (_) {
    /* best-effort */
  }
}

/** Notice when a booking is cancelled, by the client or by the center. */
export async function sendBookingCancellation(
  admin: SupabaseClient,
  bookingId: string,
  /** `credit` is the return_cancelled_booking outcome ('credited' | 'late' | …). */
  opts: { byAdmin: boolean; credit?: string | null },
): Promise<void> {
  try {
    const c = await loadBookingCtx(admin, bookingId);
    if (!c) return;
    const lead = opts.byAdmin
      ? `Hola ${c.firstName}, cancelamos tu turno. Si tenés dudas, escribinos por WhatsApp.`
      : `Hola ${c.firstName}, tu turno quedó cancelado.`;
    const note = opts.credit === "membership"
      ? opts.byAdmin
        ? "Es una clase de tu abono. Si querés recuperarla, escribinos por WhatsApp."
        : "Es una clase de tu abono: no se devuelve ni se acredita. La próxima vez podés moverla a otro horario libre hasta 24 h antes."
      : opts.credit === "credited"
      ? "Te devolvimos la sesión como crédito: la próxima vez que reserves este servicio la podés usar sin pagar de nuevo."
      : opts.credit === "late"
      ? "Como cancelaste fuera del plazo de aviso, la sesión no se devuelve. Si tuviste un imprevisto, escribinos por WhatsApp."
      : "Si fue un error o querés otro horario, podés reservar de nuevo cuando quieras.";
    const html = shell({
      heading: "Turno cancelado",
      accent: "#e5484d",
      lead,
      rows: [
        { label: "Servicio", value: c.svc },
        { label: "Fecha y hora", value: c.when },
        { label: "Reserva", value: c.ref, mono: true },
      ],
      note,
      cta: c.appUrl ? { label: "Reservar de nuevo", url: c.appUrl } : undefined,
    });
    await fanOutToUser(admin, c.userId, {
      subject: `Turno cancelado · VULL (${c.ref})`,
      html,
      push: {
        title: "Turno cancelado",
        body: `${c.svc} · ${c.when}`,
        url: `${c.appUrl}/turno/${c.bookingId}`,
      },
    });
  } catch (_) {
    /* best-effort */
  }
}

/** Confirm to the client that a PACK purchase was accredited and credits granted.
 *  There is no booking here — the pack payment carries user_id + service_id — so it
 *  can't reuse loadBookingCtx. Previously this event notified the client on no
 *  channel at all. */
export async function sendPackConfirmation(
  admin: SupabaseClient,
  paymentId: string,
): Promise<void> {
  try {
    const { data: pay } = await admin
      .from("payments")
      .select("user_id, amount_ars, services(name, sessions_included)")
      .eq("id", paymentId)
      .single();
    if (!pay) return;
    const p = pay as {
      user_id: string;
      amount_ars: number;
      // deno-lint-ignore no-explicit-any
      services: any;
    };
    const packName = p.services?.name ?? "Pack";
    const sessions = p.services?.sessions_included ?? 0;
    const appUrl = Deno.env.get("APP_URL") ?? "";

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", p.user_id)
      .single();
    const firstName = (profile?.full_name ?? "").split(" ")[0] || "Hola";
    const lead = `Hola ${firstName}, tu pago fue acreditado. Ya podés reservar tus sesiones.`;

    const html = shell({
      heading: "Sesiones acreditadas ✓",
      accent: "#61b33b",
      lead,
      rows: [
        { label: "Pack", value: packName },
        {
          label: "Sesiones",
          value: `${sessions} ${sessions === 1 ? "sesión" : "sesiones"}`,
        },
        { label: "Pagado", value: money(p.amount_ars), mono: true },
      ],
      note: "Reservás cada turno con un crédito, cuando quieras.",
      cta: appUrl ? { label: "Reservar una sesión", url: `${appUrl}/mis-turnos` } : undefined,
    });

    await fanOutToUser(admin, p.user_id, {
      subject: `Sesiones acreditadas · VULL`,
      html,
      push: {
        title: "Sesiones acreditadas ✓",
        body: `${sessions} ${sessions === 1 ? "sesión" : "sesiones"} de ${packName}`,
        url: `${appUrl}/mis-turnos`,
      },
    });
  } catch (_) {
    /* best-effort */
  }
}

// ─── Admin (owner) notifications ─────────────────────────────────────────────
// So the owner learns of a new paid booking / a transfer to verify / a client
// cancellation without refreshing /admin. Best-effort like the client emails.

// Fan out an admin alert to every owner: email (Resend) + Web Push, in parallel.
// Dead push subscriptions (404/410) are pruned. All best-effort.
export async function fanOutToAdmins(
  admin: SupabaseClient,
  subject: string,
  html: string,
  push: { title: string; body: string },
): Promise<void> {
  const { data: admins } = await admin
    .from("profiles")
    .select("id, email")
    .eq("is_admin", true);
  const rows = (admins ?? []) as { id: string; email: string | null }[];
  if (rows.length === 0) return;

  const emailJobs = rows
    .map((a) => a.email)
    .filter((e): e is string => Boolean(e))
    .map((to) => sendMail(to, subject, html));

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in(
      "user_id",
      rows.map((a) => a.id),
    );
  const payload = JSON.stringify({ ...push, url: "/admin" });
  const pushJobs = ((subs ?? []) as (PushSub & { id: string })[]).map(async (s) => {
    const status = await sendPush(
      { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
      payload,
    );
    if (status === 404 || status === 410) {
      await admin.from("push_subscriptions").delete().eq("id", s.id);
    }
  });

  await Promise.allSettled([...emailJobs, ...pushJobs]);
}

type AdminEvent =
  | "payment_to_verify"
  | "booking_confirmed"
  | "booking_cancelled_by_client";

/** Notify the owner(s) about a booking-lifecycle event. */
export async function notifyAdmins(
  admin: SupabaseClient,
  event: AdminEvent,
  bookingId: string,
): Promise<void> {
  try {
    const c = await loadBookingCtx(admin, bookingId);
    if (!c) return;
    const cta = c.appUrl ? { label: "Abrir panel", url: `${c.appUrl}/admin` } : undefined;
    const map: Record<AdminEvent, { heading: string; lead: string; subject: string; accent?: string }> = {
      payment_to_verify: {
        heading: "Pago por verificar",
        lead: `${c.firstName} subió un comprobante de transferencia para ${c.svc}.`,
        subject: `Pago por verificar · VULL (${c.ref})`,
      },
      booking_confirmed: {
        heading: "Nuevo turno confirmado ✓",
        lead: `${c.firstName} reservó y confirmó ${c.svc}.`,
        subject: `Nuevo turno · VULL (${c.ref})`,
        accent: "#61b33b",
      },
      booking_cancelled_by_client: {
        heading: "Turno cancelado por el cliente",
        lead: `${c.firstName} canceló su turno de ${c.svc}.`,
        subject: `Cancelación · VULL (${c.ref})`,
        accent: "#e5484d",
      },
    };
    const m = map[event];
    const html = shell({
      heading: m.heading,
      accent: m.accent,
      lead: m.lead,
      rows: [
        { label: "Servicio", value: c.svc },
        { label: "Fecha y hora", value: c.when },
        { label: "Importe", value: money(c.price), mono: true },
        { label: "Reserva", value: c.ref, mono: true },
      ],
      cta,
    });
    await fanOutToAdmins(admin, m.subject, html, { title: m.heading, body: m.lead });
  } catch (_) {
    /* best-effort */
  }
}

/** Generic owner alert (heading + body), email + push. */
export async function notifyAdminsSimple(
  admin: SupabaseClient,
  heading: string,
  body: string,
): Promise<void> {
  try {
    const appUrl = Deno.env.get("APP_URL") ?? "";
    const html = shell({
      heading,
      lead: body,
      cta: appUrl ? { label: "Abrir panel", url: `${appUrl}/admin` } : undefined,
    });
    await fanOutToAdmins(admin, `${heading} · VULL`, html, { title: heading, body });
  } catch (_) {
    /* best-effort */
  }
}

/** Notify the owner(s) that a pack transfer receipt needs verification. */
export async function notifyAdminsPackToVerify(
  admin: SupabaseClient,
  paymentId: string,
): Promise<void> {
  try {
    const { data: pay } = await admin
      .from("payments")
      .select("amount_ars, user_id, services(name)")
      .eq("id", paymentId)
      .single();
    if (!pay) return;
    // deno-lint-ignore no-explicit-any
    const packName = (pay as any).services?.name ?? "Pack";
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", (pay as { user_id: string }).user_id)
      .single();
    const who = (profile?.full_name ?? "Un cliente").split(" ")[0];
    const appUrl = Deno.env.get("APP_URL") ?? "";
    const lead = `${who} subió un comprobante para "${packName}".`;
    const html = shell({
      heading: "Pack por verificar",
      lead,
      rows: [
        { label: "Pack", value: packName },
        { label: "Importe", value: money((pay as { amount_ars: number }).amount_ars), mono: true },
      ],
      cta: appUrl ? { label: "Abrir panel", url: `${appUrl}/admin` } : undefined,
    });
    await fanOutToAdmins(admin, `Pack por verificar · VULL`, html, {
      title: "Pack por verificar",
      body: lead,
    });
  } catch (_) {
    /* best-effort */
  }
}
