// Notification TRANSPORT: email via the Resend HTTP API (or, in local dev
// only, the EMAIL_SINK_URL Mailpit sink), Web Push, and the two fan-outs the
// dispatcher (./notify.ts) sends through. What to say lives in
// ./notify-render.ts; when to say it, in the notifications outbox (ADR 0013).
//
// Nothing here throws on a failed delivery and nothing is swallowed either:
// every function RETURNS what happened, and every failure is logged with the
// `[notify]` prefix so it shows in the function logs. EMAIL_FROM must be a
// sender on the Resend-verified domain, e.g. `VULL <hola@vull.com.ar>`.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { sendPush, type PushSub } from "./webpush.ts";
import {
  ADDRESS_LINE,
  CONTACT_PHONE_DISPLAY,
  INSTAGRAM_HANDLE,
  INSTAGRAM_URL,
  waUrl,
} from "./site.ts";

export type MailResult = { ok: boolean; status: number; body: string };

export async function sendMail(
  to: string,
  subject: string,
  html: string,
): Promise<MailResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  if (!to) return fail(to, subject, { ok: false, status: 0, body: "no_recipient" });

  // DEV ONLY: with EMAIL_SINK_URL set (local supabase/functions/.env, never a
  // deployed secret), mail goes to Mailpit's send API instead of Resend, e.g.
  // http://host.docker.internal:54324/api/v1/send. See docs/setup.md.
  const sink = Deno.env.get("EMAIL_SINK_URL");
  const req = sink
    ? fetch(sink, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: { Email: from ?? "dev@vull.local" },
        To: [{ Email: to }],
        Subject: subject,
        HTML: html,
      }),
    })
    : apiKey && from
    ? fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    })
    : null;
  if (!req) {
    return fail(to, subject, { ok: false, status: 0, body: "email_not_configured" });
  }

  try {
    const res = await req;
    const body = await res.text().catch(() => "");
    const out = { ok: res.ok, status: res.status, body: body.slice(0, 500) };
    return res.ok ? out : fail(to, subject, out);
  } catch (e) {
    return fail(to, subject, { ok: false, status: 0, body: String(e).slice(0, 500) });
  }
}

function fail(to: string, subject: string, r: MailResult): MailResult {
  console.error("[notify] email failed", { to, subject, status: r.status, body: r.body });
  return r;
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


// ─── Fan-out ────────────────────────────────────────────────────────────────
export type PushMsg = { title: string; body: string; url?: string };
export type Msg = { subject: string; html: string; push?: PushMsg };

/** What a fan-out did. `errors` holds one line per failed delivery. */
export type FanOut = {
  emails: number;
  pushes: number;
  errors: string[];
  /** Set when a critical notice went by email because nothing else could. */
  fallback?: "email";
  /** The user wants push for this notice but has no live device to take it
   *  (none subscribed, or every one was just pruned as gone). */
  noDevice?: true;
};

/**
 * Should a user notice go by email although their preferences didn't ask for
 * it? Only for a CRITICAL notice (the centre cancelled or moved their turno)
 * that otherwise reached nobody: email off, and push on but no live device
 * took it (none subscribed, or every one was pruned as gone). Pure, so it can
 * be unit-tested (notify_test.ts).
 */
export function needsEmailFallback(o: {
  critical: boolean;
  emailAttempted: boolean;
  pushDelivered: number;
  hasEmail: boolean;
}): boolean {
  return o.critical && !o.emailAttempted && o.pushDelivered === 0 && o.hasEmail;
}

/** Push to each subscription; prune the gone ones (404/410). Returns how many
 *  were pruned. */
async function pushAll(
  admin: SupabaseClient,
  subs: (PushSub & { id: string })[],
  payload: string,
  out: FanOut,
): Promise<number> {
  let pruned = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const status = await sendPush(
        { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
        payload,
      );
      if (status >= 200 && status < 300) {
        out.pushes++;
        return;
      }
      if (status === 404 || status === 410) {
        await admin.from("push_subscriptions").delete().eq("id", s.id);
        pruned++;
        return; // a device that left is not a failure to retry
      }
      out.errors.push(status === 0 ? "push_not_configured" : `push ${status}`);
    } catch (e) {
      out.errors.push(`push ${String(e).slice(0, 200)}`);
    }
  }));
  return pruned;
}

/** The user's last device just left: push "on" now reaches nobody, so switch
 *  them to email (both columns in one update: profiles_one_channel holds). */
async function pushToEmail(admin: SupabaseClient, userId: string): Promise<void> {
  const { count } = await admin
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (count !== 0) return; // another device subscribed meanwhile (or the count failed)
  const { error } = await admin
    .from("profiles")
    .update({ notify_push: false, notify_email: true })
    .eq("id", userId);
  if (error) console.error("[notify] could not switch user to email", { userId, error: error.message });
  else console.warn("[notify] last push device gone; user switched to email", { userId });
}

async function mail(to: string, msg: Msg, out: FanOut): Promise<void> {
  const r = await sendMail(to, msg.subject, msg.html);
  if (r.ok) out.emails++;
  else out.errors.push(`email ${r.status || ""} ${r.body}`.replace(/\s+/g, " ").trim());
}

// Fan out a CLIENT notice to one user: email + Web Push, each gated by that
// user's own preference (profiles.notify_email / notify_push; the DB keeps at
// least one on). `critical` adds the email safety net (needsEmailFallback);
// `forceEmail` ignores notify_email (a desk sale to a brand-new account).
// When the user's last device is pruned, they are switched to email for next
// time (pushToEmail), and the fan-out reports `noDevice` so the notice counts
// as undelivered (outcomeOf) and its retry goes by email.
export async function fanOutToUser(
  admin: SupabaseClient,
  userId: string,
  msg: Msg,
  opts: { critical?: boolean; forceEmail?: boolean } = {},
): Promise<FanOut> {
  const out: FanOut = { emails: 0, pushes: 0, errors: [] };
  const { data: p, error } = await admin
    .from("profiles")
    .select("email, notify_email, notify_push")
    .eq("id", userId)
    .maybeSingle();
  if (error || !p) {
    out.errors.push(error ? `profile ${error.message}` : "no_profile");
    console.error("[notify] user lookup failed", { userId, error: error?.message });
    return out;
  }
  const prefs = p as { email: string | null; notify_email: boolean; notify_push: boolean };

  const emailAttempted = Boolean(prefs.email) && (prefs.notify_email || Boolean(opts.forceEmail));
  const jobs: Promise<void>[] = [];
  if (emailAttempted) jobs.push(mail(prefs.email!, msg, out));
  if (prefs.notify_push && msg.push) {
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);
    const list = (subs ?? []) as (PushSub & { id: string })[];
    jobs.push(
      pushAll(admin, list, JSON.stringify(msg.push), out).then(async (pruned) => {
        if (list.length - pruned > 0) return;
        out.noDevice = true;
        if (pruned > 0) await pushToEmail(admin, userId);
      }),
    );
  }
  await Promise.all(jobs);

  if (
    needsEmailFallback({
      critical: Boolean(opts.critical),
      emailAttempted,
      pushDelivered: out.pushes,
      hasEmail: Boolean(prefs.email),
    })
  ) {
    out.fallback = "email";
    await mail(prefs.email!, msg, out);
  }
  if (out.errors.length) console.error("[notify] user fan-out errors", { userId, errors: out.errors });
  return out;
}

// Fan out an admin notice to every owner: email + Web Push to each admin's
// devices, no preferences (they run the place). Dead subscriptions are pruned.
export async function fanOutToAdmins(admin: SupabaseClient, msg: Msg): Promise<FanOut> {
  const out: FanOut = { emails: 0, pushes: 0, errors: [] };
  const { data: admins, error } = await admin
    .from("profiles")
    .select("id, email")
    .eq("is_admin", true);
  if (error) {
    out.errors.push(`admins ${error.message}`);
    console.error("[notify] admin lookup failed", error.message);
    return out;
  }
  const rows = (admins ?? []) as { id: string; email: string | null }[];
  if (rows.length === 0) return out;

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", rows.map((a) => a.id));
  const payload = JSON.stringify({ ...(msg.push ?? { title: msg.subject, body: "" }), url: "/admin" });
  await Promise.all([
    ...rows.filter((a) => a.email).map((a) => mail(a.email!, msg, out)),
    pushAll(admin, (subs ?? []) as (PushSub & { id: string })[], payload, out),
  ]);
  if (out.errors.length) console.error("[notify] admin fan-out errors", out.errors);
  return out;
}
