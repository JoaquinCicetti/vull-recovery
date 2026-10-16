# ADR 0011 — Monthly plans (abonos) as materialized bookings

- **Status:** Accepted
- **Date:** 2026-10-15

## Context
Pilates is sold as a monthly abono, not per class. A plan gives N classes a
week. The client picks one time and one bed per chosen weekday, and that
schedule repeats every week of the month. A client may keep the same schedule
and beds every month (recurring, "horario fijo"). Recurring members pay by the
10th; later costs 10 % more. If still unpaid on the 20th, an admin may free the
slot by hand. A mid-month start pays only the classes left. An admin can sell an
abono in cash to someone with no account yet. Members can move a class to a free
slot, or swap one with another member, up to 24 h before.

The existing guarantees are per booking: `bookings_no_overlap` (one active
turno per bed and time) and `bookings_one_per_day` (one per client, day and
sector). Credits (packs) count sessions but pin no time or bed.

## Decision
1. **The weekly pattern is data; the reservation is the bookings.**
   `membership_slots` stores the pattern. Every occurrence becomes an ordinary
   `bookings` row with `membership_id`. Bed uniqueness for a whole month is the
   same EXCLUDE constraint as for a single turno, with no new invariant to keep
   in sync. Every existing screen and action works on classes unchanged.
2. **Recurring members are materialized one month ahead.** A locked, active
   membership always has its current and next month as bookings. That is what
   makes next month's beds visibly taken for everyone else. `roll_memberships`
   keeps this true. It runs lazily inside `housekeeping()` at the start of every
   booking and membership function, and from a daily cron. A collision (someone
   took the bed first) is recorded in `memberships.roll_error` and shown to
   admins; it never blocks other members.
3. **Money per calendar month.** `membership_periods` is one row per month, with
   the amount frozen when the row is created. The first month is prorated:
   classes left divided by classes in the whole month. The late surcharge is
   derived in the `membership_periods_v` view and never stored. A cuota is a
   third payments kind (`membership`), so Talo, receipts and admin approval reuse
   the existing settle paths. Cash at the desk is a real payments row
   (`provider = 'cash'`).
4. **Holds, not new expiry logic.** An unpaid self-service signup holds its
   schedule like a booking (`hold_expires_at` on the membership and on each
   class), so the existing lazy sweep frees it. A schedule an admin booked for a
   client has no hold. It never lapses on its own, and an admin releases it.
5. **Swaps exchange times, not owners.** `swap_bookings` swaps
   `starts_at/ends_at/resource_id` between two rows. Payments, turno links and
   emails stay with their owners. The per-day partial unique index can't be
   deferred, so the swap moves one row out of the active set, moves the other,
   then moves the first back, all in one transaction.
6. **No new infrastructure.** No pg_cron (ADR 0007): lazy maintenance plus an
   optional external cron, like `talo-reconcile`. No invite system: an admin sale
   creates a confirmed auth user with the client's email, and the usual
   email-code login does the rest.

## Consequences
- A month of classes is many rows (≤ 31 per member per month). That is trivial at
  this scale and buys exact, race-safe availability.
- Changing a plan's price affects cuotas created from then on, not ones already
  created (often next month's).
- Closed days and holidays are not modelled. An admin reschedules or cancels the
  affected classes.
- `already_member` (one live abono per client and sector) is checked, not
  constrained. A double click could create two abonos on different weekdays.

## Alternatives rejected
- **Credits per month (a pack that renews).** That pins no time or bed, so it
  can't guarantee "my bed every Monday".
- **Materialize only on demand (virtual slots).** Every availability query would
  have to merge patterns with bookings, and the EXCLUDE could no longer arbitrate
  races.
- **A deferrable EXCLUDE for one-per-day.** Its error code would change to
  23P01, which every booking path maps to "slot taken".
