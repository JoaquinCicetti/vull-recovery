# ADR 0012 — Admin-defined slots and a weekly client booking window

- **Status:** Accepted
- **Date:** 2026-10-18

## Context
A turno used to last its plan's `duration_minutes`, and the grid stepped by that
duration from each open range's `opens`. Two plans of different lengths in one
sector produced two different grids, and the owner could not say "on Monday
from 16:00 to 20:00 we take 30-minute turnos" without editing every plan.
Clients could also book as far ahead as `availability` showed (14 days), and
`create-booking` had no upper limit at all: any grid-aligned time months ahead
was accepted. Recovery wants clients to book only inside the current week, with
the next week opening on Sunday afternoon.

## Decision
1. **The admin defines the grid.** Each `sector_hours` range has `slot_minutes`.
   Slots step by it from the range's `opens` and must end by its `closes`. A
   turno occupies exactly ONE slot: `ends_at = starts_at + slot_minutes`.
   `services.duration_minutes` stays as information for the client. Capacity
   per slot is the number of active resources ("Lugares simultáneos"), editable
   for recovery too.
2. **Abono classes keep their plan's length.** A pilates class lasts its plan's
   duration, which must fit in the range as well as one slot
   (`create_membership`, `membership-availability`, move and admin reschedule).
   With pilates' 60-minute slots this changes nothing.
3. **A booking window per sector.** `sectors.booking_window`:
   `rolling` (the next `rolling_days` days; pilates, 14) or `week` (the current
   Mon–Sun week; recovery). For `week`, the next week opens on
   `next_week_opens_dow` at `next_week_opens_at` local time (Sunday 14:00), and
   the rest of the current week stays bookable. `bookingWindow()` in
   `_shared/booking-rules.ts` computes it, and `validateSlot` enforces it, so
   `availability` and `create-booking` agree.
4. **Admins aren't bound by the window, only by the grid.** `admin-booking`
   reschedule and abono schedules skip the window check;
   `availability` with `scope: "admin"` lists the next `rolling_days` days for
   the reschedule picker.
5. **One weekly template, no date overrides.** `sector_hours` is one recurring
   week. `windowsForDate()` is the single function that answers "when is this
   date open"; per-date overrides (holidays, a special week) go there later.
6. **Enforced at the edge, not the DB.** The window depends on `now()`, and a
   grid trigger would tie existing rows to config an admin can edit. Overlap
   (EXCLUDE) and one-per-day (unique index) stay the hard DB invariants.

## Consequences
- The migration backfills each range's `slot_minutes` with the sector's
  shortest active plan duration. From then on every booking takes one slot of
  that length, so longer plans book shorter turnos (and more per range) until an
  admin sets the slot length in Disponibilidad, which should happen right after
  apply.
- Editing `slot_minutes` doesn't move existing turnos. A turno booked on the
  old grid stays valid; a reschedule must land on the new one.
- Clients see a shorter horizon in recovery (one week, two from Sunday 14:00).
  The booking page says until when they can book and when the next week opens.
- The edge must be deployed with the migration applied first: the functions
  select `sector_hours.slot_minutes` and the new `sectors` columns.
