# ADR 0013 — Notifications as an outbox written beside the invariant

- **Status:** Accepted
- **Date:** 2026-10-18

## Context
Every email and push was sent fire-and-forget from the edge function that
caused it. `sendMail` returned `false` on a non-2xx and logged nothing; every
caller wrapped it in `catch (_) {}`; `defer()` discarded errors and
`EdgeRuntime.waitUntil` was optional. `EMAIL_FROM` and `RESEND_API_KEY` were
only set on the cloud project on 2026-10-13, so every edge email before that
silently did nothing, and nobody could have known.

The decision of WHO to tell was copied too. Four places confirmed a booking
(talo-settle, admin-payment, admin-booking, mobbex-webhook), two cancelled one
(cancel-booking, calendar-poll), each with its own notices. Events with money
attached told nobody: a pack or a cuota settled by Talo, a receipt rejected by
an admin, a turno moved by an admin, a client moving a class.

The owner's rules: admins hear when a client pays, books (including each
session spent from a pack), cancels or moves a class, and paying a turno at
booking is ONE notice. What an admin does is never news to the other admins,
only to the client. Clients hear when the centre cancels or moves their turno
and when a receipt is rejected, through the channels they chose, with at least
one channel always on.

## Decision
1. **An outbox table.** `notifications` holds one row per notice: `kind`,
   `subject_id` (the booking, payment, cuota, membership or swap it is about),
   `audience` (`admins` | `user`), `actor` (`client` | `admin` | `system`),
   `payload`, and the delivery state (`claimed_at`, `sent_at`, `attempts`,
   `error`, `channels`). `unique nulls not distinct (kind, subject_id, audience,
   dedup_key)` makes every emit idempotent: a webhook storm, a reconcile run or
   a double click queues nothing new.
2. **Written by the transition, in its transaction.** The booking transitions
   become one RPC each (`confirm_booking`, `cancel_booking`,
   `reschedule_booking`) and, like `book_with_credit`, `grant_pack_credits`,
   `approve_membership_period`, `release_membership`, `set_membership_locked`,
   `propose_swap`, `resolve_swap` and `roll_memberships`, call
   `emit_notification` themselves. A committed change always has its notice; a
   rolled-back one never does. `actor` decides the admins' copy: emitted only
   when the actor is not `admin`. Events with no SQL transition of their own
   (receipt uploaded or rejected, a class moved, a desk sale, Talo and calendar
   anomalies) are emitted by the edge right after its write.
3. **One dispatcher.** `_shared/notify.ts` claims rows (`claim_notifications`:
   a 2-minute lease, `for update skip locked`, at most 5 attempts), renders each
   with the renderer for its (kind, audience) (`_shared/notify-render.ts`), sends
   it through `fanOutToAdmins` / `fanOutToUser` (`_shared/email.ts`, transport
   only) and records `sent_at` + `channels`, or `error`. User-facing functions
   and the Talo webhook `kick()` it after their response; crons `await` it
   before answering; the `notify-dispatch` cron (every 5 min) is the safety net.
4. **Failures are visible.** Transport functions return what happened
   (`sendMail → {ok, status, body}`, fan-outs → `{emails, pushes, errors}`) and
   log every failure with `[notify]`. A row that delivered nothing and errored
   stays on /admin "Avisos no enviados" until a retry sends it
   (`retry_notification`, then `notify-dispatch` called with the admin's JWT
   instead of the cron token).
5. **At least one channel, push only when real.** `profiles_one_channel`
   requires `notify_email or notify_push`. Push turns on only after the browser
   verified support (and, on iOS, the installed app) and stored a subscription;
   it now defaults to off. A critical notice (the centre cancelled or moved the
   turno) that reached nobody falls back to email and records
   `channels.fallback = "email"`. A desk sale ignores the email preference: the
   account may be brand new. Pruning a user's last device (404/410) switches
   them to email; a notice that wanted push and found no live device counts as
   not sent (`push_no_device`), so it shows on /admin and its retry goes by email.
6. **Mobbex is gone.** `mobbex-webhook` was the fourth copy of "confirm a
   booking". It, `_shared/mobbex.ts` and the Mobbex branch of `create-payment`
   are deleted, as ADR 0010 planned.

## Consequences
- The migration must be applied BEFORE the functions are deployed: they call the
  new RPCs, and `grant_pack_credits`, `approve_membership_period` and
  `set_membership_locked` gained an argument.
- A new secret (`NOTIFY_DISPATCH_TOKEN`) and a new external cron
  (`notify-dispatch`, every 5 min). `supabase/.env.secrets.example` is now the
  canonical list of edge secrets and `scripts/deploy.sh` warns about missing
  ones.
- Rendering happens at send time, from the current rows. A notice sent late
  shows the subject as it is then; the facts that must not drift (a reschedule's
  old and new time, the credits left) travel in `payload`.
- Delivery is at-least-once: a dispatcher that dies after sending but before
  recording re-sends after the lease. A duplicate email is preferable to a lost
  one.
- Existing clients with push "on" and no device were switched to push off: no
  delivery changes, the preference now tells the truth.
- WhatsApp stays out of scope: there is no outbound integration (ADR 0002).

## Alternatives rejected
- **Keep sending inline, add logging.** Makes failures visible but still loses
  notices when the isolate is torn down, and leaves the who-to-tell logic copied
  across functions.
- **Database webhooks / pg_net triggers calling a function per row.** Another
  moving part with its own retry semantics, and the free tier's pg_net has no
  delivery guarantees either; the cron + lease gives the same result with code
  we already run.
- **A queue service.** Contradicts ADR 0001 (zero fixed cost) for a few dozen
  notices a day.
