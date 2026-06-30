# ADR 0009 — Booking invariants: one-per-day at the DB, re-validate at the edge

- **Status:** Accepted
- **Date:** 2026-06-30

## Context
Two product rules were under-enforced. (1) "A client may book at most one turno
per day" was enforced **nowhere** — the `bookings_no_overlap` EXCLUDE constraint
([ADR 0007](0007-db-level-no-double-booking.md)) only blocks time overlap between
any users, with no per-user/per-day dimension. (2) The remaining slot rules
(working hours/days, 60-min lead, slot-grid alignment, Google freeBusy) lived
**only** in the public `availability` function; `create-booking` trusted the
client-supplied `starts_at` (it checked only "not in the past"), so a crafted or
stale request could book at 03:00, on a closed day, off-grid, or over a Google
Calendar busy block the DB constraint cannot see.

## Decision
1. **One turno per local day, guaranteed at the DB.** A partial UNIQUE index
   `bookings_one_per_day` on `(user_id, booking_local_date(starts_at))` over the
   active statuses. Same race-safety reasoning as ADR 0007's EXCLUDE: an
   edge-only check-then-insert is racy, the index is not. `booking_local_date`
   maps an instant to the Buenos Aires calendar date with a **constant -3h
   offset** so it can be `IMMUTABLE` (indexable). `create-booking` adds a friendly
   pre-check and maps `23505` to a Spanish 409.
2. **Re-validate every slot rule server-side.** The slot-legality logic is
   extracted to `_shared/booking-rules.ts` (`validateSlot`) and used by **both**
   `availability` and `create-booking`, so they cannot drift. `create-booking`
   re-runs it (including a best-effort `getBusy()` overlap) before insert.
3. **Document the contract.** `docs/booking-invariants.md` is the authoritative
   table (rule → layer → Postgres code → message). Counted "active" = the single
   set `{pending, awaiting_payment, confirmed}` shared by every guard.

## Consequences
- Max-1-per-day is race-safe and cannot be bypassed; cancelled/expired bookings
  free the day automatically (partial predicate).
- `create-booking` and `availability` agree by construction; the public function
  can no longer offer a slot the writer would reject, and a direct POST can no
  longer escape the rules.
- Booking-vs-booking overlap stays HARD (DB); Google freeBusy overlap is
  **best-effort** (the EXCLUDE constraint does not cover external calendar
  blocks, and `getBusy` no-ops when Google is unconfigured).
- The constant-offset day helper assumes Argentina's fixed UTC-3 (no DST). A
  DST-observing `settings.timezone` would compute the wrong day near transitions
  and must be revisited (see booking-invariants.md).
- A future admin walk-in / second-same-day booking would trip the index; an
  exemption (e.g. a `created_by_admin` path) must be designed then, not worked
  around by weakening the index.

## Alternatives considered
- **Edge-only per-day check** (no index) — simplest, but racy: two concurrent
  same-day requests both pass. Rejected; kept only as the friendly pre-check on
  top of the index.
- **BEFORE INSERT/UPDATE trigger reading `settings.timezone`** — more
  DST-flexible, but concurrency-fragile (still needs a unique mechanism to be
  race-safe) and slower. Rejected in favor of the partial unique index, parallel
  to ADR 0007.
- **Generated `STORED` local-date column** — forces a table rewrite and bakes the
  offset into stored data; an expression index avoids both. Rejected.
