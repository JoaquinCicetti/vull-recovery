// Pure parts of the notification dispatcher (ADR 0013): which renderer a row
// gets, when a critical notice falls back to email, and when a row counts as
// sent. Run: cd supabase/functions && pnpm dlx deno@2 test
import { assert, assertEquals } from "jsr:@std/assert@1";
import { needsEmailFallback } from "./email.ts";
import { outcomeOf } from "./notify.ts";
import { RENDERERS, rendererFor } from "./notify-render.ts";

// Every (kind, audience) some transition emits. Keep in step with the
// emit_notification calls in supabase/migrations/20261018130000_notifications_outbox.sql
// and the edge `emit()` calls.
const EMITTED: [string, "admins" | "user"][] = [
  ["booking_received", "user"],
  ["booking_confirmed", "user"],
  ["booking_confirmed", "admins"],
  ["booking_cancelled", "user"],
  ["booking_cancelled", "admins"],
  ["booking_rescheduled", "user"],
  ["payment_to_verify", "admins"],
  ["payment_rejected", "user"],
  ["pack_purchased", "user"],
  ["pack_purchased", "admins"],
  ["membership_paid", "user"],
  ["membership_paid", "admins"],
  ["membership_created_by_admin", "user"],
  ["membership_cancelled", "user"],
  ["membership_cancelled", "admins"],
  ["class_moved", "admins"],
  ["swap_proposed", "user"],
  ["swap_resolved", "user"],
  ["admin_alert", "admins"],
];

// The kinds the notifications.kind CHECK allows.
const KINDS = [
  "booking_received", "booking_confirmed", "booking_cancelled", "booking_rescheduled",
  "payment_to_verify", "payment_rejected", "pack_purchased", "membership_paid",
  "membership_created_by_admin", "membership_cancelled", "class_moved", "swap_proposed",
  "swap_resolved", "admin_alert",
];

Deno.test("every emitted (kind, audience) has a renderer", () => {
  for (const [kind, audience] of EMITTED) {
    assert(rendererFor(kind, audience), `${kind}/${audience} has no renderer`);
  }
});

Deno.test("the renderer table covers exactly the kinds the DB allows", () => {
  assertEquals(Object.keys(RENDERERS).sort(), [...KINDS].sort());
});

Deno.test("unknown kinds and audiences get no renderer", () => {
  assertEquals(rendererFor("nope", "user"), undefined);
  assertEquals(rendererFor("payment_to_verify", "user"), undefined); // admins only
  assertEquals(rendererFor("admin_alert", "user"), undefined);
});

Deno.test("email fallback: only critical, only when nothing else reached them", () => {
  const base = { critical: true, emailAttempted: false, pushDelivered: 0, hasEmail: true };
  // push on, every device gone (or none) → email anyway
  assert(needsEmailFallback(base));
  // not critical → respect the preferences
  assert(!needsEmailFallback({ ...base, critical: false }));
  // email was on (sent or failed and retried) → no second email
  assert(!needsEmailFallback({ ...base, emailAttempted: true }));
  // a device got the push → delivered
  assert(!needsEmailFallback({ ...base, pushDelivered: 1 }));
  // no address → nothing to fall back to
  assert(!needsEmailFallback({ ...base, hasEmail: false }));
});

Deno.test("outcome: sent when delivered or nothing to deliver; failed only on errors", () => {
  assertEquals(outcomeOf({ emails: 1, pushes: 0, errors: ["push 500"] }), { sent: true, error: null });
  assertEquals(outcomeOf({ emails: 0, pushes: 0, errors: [] }), { sent: true, error: null });
  assertEquals(
    outcomeOf({ emails: 0, pushes: 0, errors: ["email 403 domain not verified"] }),
    { sent: false, error: "email 403 domain not verified" },
  );
});

Deno.test("outcome: push wanted, no live device, nothing else → failed", () => {
  // push on, email off, last device pruned (or none): reached nobody
  assertEquals(
    outcomeOf({ emails: 0, pushes: 0, errors: [], noDevice: true }),
    { sent: false, error: "push_no_device" },
  );
  // a critical notice's email fallback went out → delivered
  assertEquals(
    outcomeOf({ emails: 1, pushes: 0, errors: [], noDevice: true, fallback: "email" }),
    { sent: true, error: null },
  );
  // email was on too and got there → delivered
  assertEquals(outcomeOf({ emails: 1, pushes: 0, errors: [], noDevice: true }), { sent: true, error: null });
  // the fallback failed as well → both reasons recorded
  assertEquals(
    outcomeOf({ emails: 0, pushes: 0, errors: ["email 500 down"], noDevice: true, fallback: "email" }),
    { sent: false, error: "email 500 down; push_no_device" },
  );
});
