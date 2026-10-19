# ADR 0014 — No manual confirmation; cash is an admin slot block

- **Status:** Accepted
- **Date:** 2026-10-19

## Context
ADR 0010 made Talo transfers the way to pay and kept the manual receipt
(client transfers to the centre's own alias, uploads a proof, an admin
approves) as the $0 fallback. In practice the fallback was the problem: the
owner reviewed receipts by hand, a turno sat `awaiting_payment` for as long as
the review took, an admin "confirm" button existed that said *paid* without any
money moving through the system, and the "Pagos" section of the panel existed
only to feed that queue.

The real case behind it was never a transfer at all: a client pays **cash at
the desk**, or walks in. What the owner needs for them is not a payment record
but a **slot that nobody else can take**, under a name.

## Decision
1. **Talo is the only way to pay** from the app. `create-payment` accepts
   `method: "talo"` only; the receipt upload, the Storage path and the
   `payment_to_verify` queue are gone from the client. `NEXT_PUBLIC_TALO_ENABLED`
   must be true wherever clients pay; when it is false the pay button is a
   "write us on WhatsApp" line, never a dead button.
2. **There is no manual confirm.** `admin-booking` has no `confirm` action and
   the panel has no "Marcar pagado". A turno is `confirmed` by its payment
   (`confirm_booking`, called from the Talo settle path) or by a pack credit, or
   it is not confirmed.
3. **Cash at the desk is a slot block.** An admin blocks a slot under a name
   (`admin-booking` action `block`): a `bookings` row with `user_id null`,
   `block_label`, `block_by`, `status confirmed`. It is a booking in every other
   respect, which is the point — the `bookings_no_overlap` EXCLUDE arbitrates it
   against online bookings race-safely, `availability` and the abono roll see
   it as taken, the Google event is created like any other, and the agenda lists
   it in its slot with a "Bloqueado" tag. `unblock` cancels it (no notice:
   nobody to tell). `bookings_block_shape` enforces "a client or a label, never
   both, never neither".
4. **The panel has no money section.** Talo flags (underpaid, reversed, paid
   without a slot…) and any legacy receipt show at the top of the agenda only
   when there is one. Abono cuotas live with the abonos (a "Con cuota vencida"
   filter, "Cobré la cuota en efectivo" in the row's menu). Cash for a cuota
   stays a thing: it is one payment for a whole month of classes the system
   already holds, so it is recorded, not blocked.

## Consequences
- The `receipts` bucket, `payments.receipt_path` and the manual rows keep
  existing for history; nothing new is written there. `rivalPayment` still
  refuses a Talo CVU on top of a legacy pending receipt.
- `awaiting_payment` is now only "Talo saw money on its way".
- `return_cancelled_booking` never runs for a block (`cancel_booking` returns
  `'block'`); the three transition RPCs skip the client notice when
  `user_id` is null.
- Metrics count a block as an attended turno (it was a real session) and as no
  revenue (none went through the app).
- A client who booked online and then wants to pay cash has no path in the app:
  the admin cancels the online turno (the hold lapses on its own anyway) and
  blocks the slot under their name. This is deliberate: one source of truth for
  "paid" (Talo) and one for "taken" (the bookings table).
