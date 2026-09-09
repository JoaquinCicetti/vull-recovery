# ADR 0010 — Payments via Talo automatic bank transfers, manual receipt as $0 fallback

- **Status:** Accepted (supersedes [ADR 0003](0003-payments-mobbex-with-manual-fallback.md))
- **Date:** 2026-09-09

## Context
ADR 0003 chose Mobbex for online payments. The merchant account was never
enabled, the integration shipped with two P0-class holes
(`docs/audit-2026-08.md` §7), and it bolted a card checkout onto clients who
already pay by bank transfer. Meanwhile the only live path — transfer to the
centre's alias, upload a receipt, wait for an admin — works but confirms
nothing automatically.

**Talo** (talo.com.ar, *transferencias bancarias*) mints a one-time CVU + alias
per payment, watches for the incoming transfer, and notifies us. It is the same
rail clients already use, settled automatically, priced per transaction, with a
self-serve sandbox. That clears ADR 0001's zero-fixed-cost bar.

Two facts about Talo shape the whole design:

1. **No webhook signature today** (the docs promise `X-Talo-Signature` "pronto"),
   and the webhook body is deliberately minimal — `{message, paymentId}`, no
   status, no amount.
2. **Money arrives before we hear about it and cannot be declined.** "Confirm the
   booking before settling the money" can only decide who gets alerted, not
   prevent a bad outcome.

## Decision
Talo replaces Mobbex as the online path. Manual receipt + admin approval stays as
the $0 fallback. Concretely:

- **The webhook is a trigger, not a fact.** `talo-webhook` accepts a `?token=`
  (fail-closed, timing-safe) and then `_shared/talo-settle.ts` re-fetches the
  payment from Talo with a Bearer token. There is *no* fall-back-to-the-body
  branch. The token is therefore a rate-limit gate, not the authority: a leaked
  token buys nothing but the ability to make us re-check our own ids.
- **One settle path**, shared by the webhook and `talo-reconcile` (a cron sweep of
  unsettled payments). Talo's retry policy is undocumented; the reconciler makes
  the webhook a latency optimisation rather than a correctness dependency.
- **Compare what arrived, not what we asked for.** `price.amount` is our own
  request and proves nothing. Settlement sums Talo's `transactions` and compares
  to `payments.amount_ars` (the row, never the live service price). If the
  received amount cannot be parsed the payment stays `pending` with an admin
  alert — never approved.
- **Our row first, Talo second.** `create-payment` inserts the `payments` row,
  then mints the CVU with `external_id = <row id>`, then patches
  `talo_payment_id`. Resolution is by `talo_payment_id`; the one fallback (the
  create→patch window) resolves by the `external_id` *of the authenticated GET*,
  first-writer-wins.
- **The money window and the slot hold are the same instant.** The CVU expires at
  `min(now + TALO_PAYMENT_MINUTES, starts_at − 1h)` and `bookings.hold_expires_at`
  is set to the same value. The booking stays `pending` — it is *not* flipped to
  `awaiting_payment` for merely handing out a CVU — so an abandoned CVU is freed
  by the existing lazy hold sweep. It moves to `awaiting_payment` only once Talo
  records a transaction, and to `confirmed` on settlement.
- **`EXPIRED` never means "no money"** unless Talo shows zero transactions. A
  transfer that credits after the window flags the row for a human instead of
  being rejected while we hold the client's pesos.
- **Never two live ways to pay one thing.** A Talo CVU and a manual receipt for
  the same booking/pack are mutually exclusive at the server; switching kills the
  CVU. Otherwise the webhook approves one row and an admin the other, and a pack
  grants its credits twice.
- **Terminal bookings kill their CVU** (cancel, admin reject, external calendar
  cancel) so a cancelled turno cannot keep quietly accepting money.
- Reversals after approval set `reversed_at` + an admin flag and **never**
  auto-cancel a confirmed booking; Talo rows needing a human appear in the admin
  queue with the reason.
- Hand-rolled `fetch` in `_shared/talo.ts`, not the `talo-pay` npm SDK: the edge
  functions use `jsr:` imports only, and the SDK's webhook handler structurally
  encourages trusting the body.

## Assumptions to verify in sandbox (release gates)
The public docs do not cover these. The sandbox run in
`docs/setup.md` §9 resolves each before `NEXT_PUBLIC_TALO_ENABLED` goes true in
production:

1. Whether `POST /payments/` needs the Bearer (we send it regardless).
2. Whether the webhook body carries `externalId` (the design does not depend on it).
3. The token's TTL (read from the JWT `exp`) and whether Talo permits more than
   one active token per credential.
4. **What Talo does with a transfer to an expired payment** — bounced, or credited
   against a dead CVU. Until answered, `EXPIRED → rejected` is only applied when
   Talo shows zero transactions.
5. The field carrying the **received** amount (`parseReceived` reads several
   shapes and refuses to guess).
6. Whether any client-reachable Talo surface echoes `webhook_url` back, which
   would leak the webhook token.

## Consequences
- Bookings confirm themselves within seconds of the transfer, on the rail
  clients already use; no card fees, no merchant onboarding.
- `payment_provider` gains `'talo'`; `payments` gains `talo_payment_id` (unique),
  `talo_cvu`, `talo_alias`, `talo_expires_at`, `reversed_at`, `admin_flag`.
  `payment_status` is deliberately unchanged.
- The booking-status sets move to `_shared/booking-status.ts` /
  `lib/booking-status.ts`; the remaining inline copies are a tracked follow-up.
- Two public endpoints (`talo-webhook`, `talo-reconcile`), each gated by its own
  secret, plus an external cron every ~10 minutes.
- The Mobbex code is retired in a follow-up commit once the sandbox run passes:
  delete `mobbex-webhook`, `_shared/mobbex.ts`, the Mobbex branch of
  `create-payment`, and run `supabase functions delete mobbex-webhook` (removing
  the config block does not undeploy a live endpoint).

## Alternatives considered
- **Keep Mobbex** — never enabled, card-centric, and seven audit items away from
  being safe. Rejected.
- **Talo crypto checkout** — same API, wrong rail for this clientele. Rejected.
- **Talo's `talo-pay` SDK** — pulls zod v3 into money code, `npm:` where the repo
  is `jsr:`-only, and hides the verify-server-side step. Rejected; its source was
  read for field names.
- **A single 5-day CVU per booking** — squats a slot and a day for a client who
  may never pay, and lets a transfer land after the session. Rejected in favour
  of the aligned 30-minute window.
