// The ONE dispatcher of the notifications outbox (ADR 0013).
//
// Transitions write notices into public.notifications inside their own
// transaction (emit_notification, called from the SQL RPCs or, for the few
// edge-only events, by the edge function right after its write). This file is
// the only thing that sends them:
//
//   claim (2-minute lease, skip locked) → render → fan out → record the result.
//
// A row is SENT when something was delivered, or when there was nothing to
// deliver and nothing failed (e.g. a client with push on and no device yet). It
// FAILS when nothing was delivered and something errored: the row keeps
// `error`, is retried after the lease (up to 5 attempts), and shows on /admin
// ("Avisos no enviados") until it goes out.
//
// Callers:
//   kick(admin)            user-facing functions, after the response (defer)
//   await dispatch(admin)  webhooks and crons, before they answer
//   notify-dispatch        the external cron every ~5 min: the safety net for
//                          anything a kick lost
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { defer } from "./background.ts";
import { type FanOut, fanOutToAdmins, fanOutToUser } from "./email.ts";
import { type NotificationRow, rendererFor } from "./notify-render.ts";

const BATCH = 20;
const BUDGET_MS = 20_000;

/** Did this fan-out deliver, and if not, what to record? Pure (notify_test.ts). */
export function outcomeOf(f: FanOut): { sent: boolean; error: string | null } {
  if (f.emails + f.pushes > 0) return { sent: true, error: null };
  if (f.errors.length === 0) return { sent: true, error: null }; // nothing to deliver
  return { sent: false, error: f.errors.join("; ").slice(0, 1000) };
}

async function sendOne(admin: SupabaseClient, row: NotificationRow): Promise<boolean> {
  let fan: FanOut;
  let skipped: string | null = null;
  try {
    const render = rendererFor(row.kind, row.audience);
    const msg = render ? await render(admin, row) : null;
    if (!render) skipped = "no_renderer";
    else if (!msg) skipped = "subject_gone";

    if (!msg) {
      fan = { emails: 0, pushes: 0, errors: [] };
    } else if (row.audience === "admins") {
      fan = await fanOutToAdmins(admin, msg);
    } else if (!row.user_id) {
      fan = { emails: 0, pushes: 0, errors: ["no_user"] };
    } else {
      fan = await fanOutToUser(admin, row.user_id, msg, {
        critical: msg.critical,
        forceEmail: msg.forceEmail,
      });
    }
  } catch (e) {
    fan = { emails: 0, pushes: 0, errors: [`render ${String(e).slice(0, 300)}`] };
  }

  const { sent, error } = outcomeOf(fan);
  const channels = {
    emails: fan.emails,
    pushes: fan.pushes,
    ...(fan.errors.length ? { errors: fan.errors } : {}),
    ...(fan.fallback ? { fallback: fan.fallback } : {}),
    ...(skipped ? { skipped } : {}),
  };
  if (!sent) {
    console.error("[notify] not sent", { id: row.id, kind: row.kind, audience: row.audience, error });
  }
  const { error: upErr } = await admin
    .from("notifications")
    .update(sent ? { sent_at: new Date().toISOString(), error: null, channels } : { error, channels })
    .eq("id", row.id);
  if (upErr) console.error("[notify] could not record result", { id: row.id, error: upErr.message });
  return sent;
}

/** Send everything due. Loops until the queue is empty or ~20 s passed. */
export async function dispatch(admin: SupabaseClient): Promise<{ sent: number; failed: number }> {
  const started = Date.now();
  let sent = 0;
  let failed = 0;
  while (Date.now() - started < BUDGET_MS) {
    const { data, error } = await admin.rpc("claim_notifications", { p_limit: BATCH });
    if (error) {
      console.error("[notify] claim failed", error.message);
      break;
    }
    const rows = (data ?? []) as NotificationRow[];
    if (rows.length === 0) break;
    const results = await Promise.all(rows.map((r) => sendOne(admin, r)));
    for (const ok of results) ok ? sent++ : failed++;
  }
  return { sent, failed };
}

/** Send what this request just queued, after the response. */
export function kick(admin: SupabaseClient): void {
  defer(() => dispatch(admin));
}

/** Queue a notice from the edge, for the events that have no SQL transition of
 *  their own (receipt uploaded, receipt rejected, a class moved, Talo/calendar
 *  anomalies). Never throws: the caller's write already happened. */
export async function emit(
  admin: SupabaseClient,
  n: {
    kind: string;
    subject: string | null;
    audience: "admins" | "user";
    actor: "client" | "admin" | "system";
    user?: string | null;
    payload?: Record<string, unknown>;
    dedup?: string;
  },
): Promise<void> {
  const { error } = await admin.rpc("emit_notification", {
    p_kind: n.kind,
    p_subject: n.subject,
    p_audience: n.audience,
    p_actor: n.actor,
    p_user: n.user ?? null,
    p_payload: n.payload ?? {},
    p_dedup: n.dedup ?? "",
  });
  if (error) console.error("[notify] emit failed", { kind: n.kind, error: error.message });
}

/** A free-text alert to the admins, once per `dedup` (e.g. `${paymentId}:flag`). */
export function emitAdminAlert(
  admin: SupabaseClient,
  a: { subject: string | null; dedup: string; heading: string; body: string },
): Promise<void> {
  return emit(admin, {
    kind: "admin_alert",
    subject: a.subject,
    audience: "admins",
    actor: "system",
    payload: { heading: a.heading, body: a.body },
    dedup: a.dedup,
  });
}
