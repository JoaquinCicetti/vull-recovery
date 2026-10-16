# Booking invariants

The rules a turno must satisfy, the layer(s) that enforce each, and the exact
Spanish message the client sees. **HARD** invariants are guaranteed at the
database (race-safe, cannot be bypassed by a crafted request); **edge** rules are
re-validated server-side in `create-booking`; **best-effort** rules depend on an
external system. The client UX layer only prevents obvious mistakes early — it is
never the guarantee.

The decision behind the two headline rules is recorded in
[ADR 0007](adr/0007-db-level-no-double-booking.md) (no double-booking) and
[ADR 0009](adr/0009-booking-invariants-enforcement.md) (one-per-day + server-side
re-validation).

Every rule is **per sector** (recovery, pilates, …): each sector has its own
agenda and policies on its `sectors` row, and its own resources (recovery's room,
pilates' beds). See [Sectors](#sectors-and-resources) below.

| Invariant | DB layer | Edge layer (`create-booking`) | Client UX | PG code | Message (es) |
|-----------|----------|-------------------------------|-----------|---------|--------------|
| **No time overlap per resource** (HARD) | `bookings_no_overlap` EXCLUDE gist on `(resource_id, during)`; the insert trigger raises the same code when no resource is free | `23P01` → 409 | `availability` hides taken slots | `23P01` | "Ese horario ya fue reservado. Elegí otro." |
| **Max 1 turno per local day per user per sector** (HARD) | `bookings_one_per_day` partial UNIQUE on `(user_id, sector_id, booking_local_date(starts_at))` | pre-check query + `23505` → 409 | booked days disabled in the calendar | `23505` | "Ya tenés un turno reservado para ese día. Cancelalo si querés elegir otro horario." |
| `ends_at > starts_at` (HARD) | `bookings_time_valid` CHECK | (n/a) | (n/a) | `23514` | — |
| No past slot | — | `start < now` → 400 | past days not shown | — | "Ese horario ya pasó" |
| Lead time ≥ `sectors.lead_minutes` | — | `validateSlot` | earliest filter | — | "Necesitás reservar con al menos una hora de anticipación." |
| Open that weekday | — | `validateSlot` (no `sector_hours` row that weekday) | closed days disabled | — | "Ese día no está disponible para reservar." |
| Inside one open range | — | `validateSlot` (`[start, end]` within one range) | only in-range slots shown | — | "Ese horario está fuera del horario de atención." |
| Slot-grid aligned | — | `validateSlot` (steps of the plan's duration from **that range's** `opens`) | only grid slots shown | — | "Ese horario no está disponible." |
| Open ranges of a weekday don't overlap (HARD) | `sector_hours_no_overlap` EXCLUDE | (admin form validates) | — | `23P01` | "Dos rangos del mismo día se superponen." |
| No Google freeBusy overlap (**best-effort**) | — (NOT in the EXCLUDE) | `validateSlot` over `getBusy()` | `availability` subtracts busy | — | "Ese horario ya no está disponible. Elegí otro." |

`validateSlot` and the working-window logic live in
`supabase/functions/_shared/booking-rules.ts` and are the **single source** used
by both `availability` (to generate slots) and `create-booking` (to re-validate
the submitted time), so the two cannot drift.

Abono classes add their own rules: see [Memberships](#memberships-abonos) and
[Moving and swapping classes](#moving-and-swapping-classes).

## Active statuses (single source of truth)

A booking "holds" a slot/day only in statuses **`pending`, `awaiting_payment`,
`confirmed`**. The canonical sets live in
`supabase/functions/_shared/booking-status.ts` (`ACTIVE`, `CONFIRMABLE`,
`PAYABLE`, `TERMINAL`) with a deliberate browser-side mirror in
`lib/booking-status.ts`. `create-payment`, `admin-payment` and the Talo settle
path import from there; the remaining inline copies are being migrated and must
stay in sync meanwhile:

- `bookings_no_overlap` EXCLUDE predicate (init migration)
- `bookings_one_per_day` partial-index predicate
- `availability` active-bookings query and `create-booking` per-day pre-check
- `cancel-booking` `CANCELLABLE`

Cancelling or expiring a booking drops it out of these predicates, freeing both
the slot and the day automatically.

The lazy sweep is now one RPC, `housekeeping()` (service role): the booking hold
sweep, abono expiry, the abono roll and stale swap offers. `availability`,
`create-booking` and every abono function call it first. `MAX_ACTIVE_HOLDS`
counts only bookings **without** `membership_id`: an unpaid abono is a dozen
pending classes, which is one hold, not twelve.

## Cancelling a paid turno

A paid turno — funded by a pack credit or an approved, non-reversed booking
payment — comes back as **one credit for the same service**, never as money:

- client cancels **≥ `sectors.cancel_notice_hours`** (24 h by default) before
  `starts_at` → credit
- client cancels later → nothing (the admin can still `adjust_credit` by hand)
- admin cancel or Google Calendar cancel → always credit

The rule lives only in `return_cancelled_booking` (SQL), called by
`cancel-booking` and `calendar-poll`; at most one return per booking is enforced
by `credit_ledger_return_uniq`. The turno page mirrors the sector's window for
copy only.

## Holds

A new booking is `pending` with `hold_expires_at`. Expired **pending** holds are
freed **lazily** (no cron) at the start of `availability` and `create-booking`.
The hold lasts the sector's `hold_minutes` (10 by default; it replaced the
`BOOKING_HOLD_MINUTES` env var). The server-authoritative countdown UI reads
`hold_expires_at` directly, so it always agrees with the DB.

A **Talo transfer** does not change this: `create-payment` keeps the booking
`pending` and extends `hold_expires_at` to the CVU's expiry
(`TALO_PAYMENT_MINUTES`, capped an hour before the turno), so an abandoned CVU is
swept exactly like a lapsed hold. The booking moves to `awaiting_payment` only
once Talo records a transaction on its way (ADR 0010).

An **abono signup** holds its whole schedule the same way. The membership and
each of its pending classes carry the same `hold_expires_at`, and a Talo CVU
extends both. Once money is detected, or a receipt is uploaded, the hold is
cleared and the classes wait as `awaiting_payment`. A schedule an admin booked
for a client has **no** hold: it never lapses on its own (it shows in the
admin's overdue list instead).

**Caveat:** `awaiting_payment` holds from an uploaded **manual receipt** still
never auto-expire, so they hold their slot and day until approved, rejected, or
cancelled. An expiry/SLA for unverified receipts is tracked in
`docs/audit-and-roadmap.md`.

## Timezone assumption (UTC-3, no DST)

`booking_local_date(ts)` (the per-day index helper) uses a **constant -3h offset**
because Argentina observes no DST today. This is what lets it be `IMMUTABLE` (and
therefore indexable): `AT TIME ZONE 'America/Argentina/Buenos_Aires'` is `STABLE`
and a bare `::date` cast depends on the session `TimeZone`, so neither can be used
in an index. The edge helpers in `_shared/time.ts` use the real `Intl` API and are
DST-correct for any zone, and they coincide with the constant-offset helper for
Argentina. **If `settings.timezone` is ever changed to a DST-observing zone, the
per-day index helper must be revisited** (per-slot offset, or a trigger keyed on
the live tz).

Abono month math ("this month", due day, release day, same week/month for
moves) uses `now() at time zone sectors.timezone` in SQL and `localYMD` at the
edge. Both coincide with the constant-offset helper for every
`America/Argentina/*` zone.

## Sectors and resources

A **sector** (`sectors`) is an area with its own agenda and policies:
`timezone`, `lead_minutes`, `hold_minutes`, `cancel_notice_hours`,
`change_notice_hours`, and the abono billing policy `due_day` / `late_fee_pct` /
`release_day`. Its opening hours are rows in `sector_hours`: one or more
`opens`–`closes` ranges per weekday, and a weekday with none is closed. These
replaced `working_hours_start/end` and `working_days`. A plan belongs to one
sector; a turno occupies one **resource** (`resources`) of it.

- **Bed assignment.** For a single turno, clients pick a time, never a resource. `availability` shows
  a slot while any active resource is free; on insert the `bookings_set_sector`
  trigger gives the turno the first free active resource, serialized per sector
  by an advisory lock so concurrent bookings don't race for the same bed. No free
  bed → `23P01`, same as a taken slot. A reschedule clears `resource_id` so the
  trigger picks a bed free at the new time.
- **Launch flag.** `sectors.active = false` hides a sector from everyone but
  admins: RLS hides the sector row and its plans (`services_read`), and
  `availability`, `create-booking` and `create-payment` (packs) check the same
  rule via `_shared/sector.ts`, since they run with the service role. Pilates
  ships this way; it launches from Admin → Disponibilidad → "Visible para
  clientes". Recovery can't be hidden from the UI.
- **Google Calendar** stays recovery-only: recovery uses `GOOGLE_CALENDAR_ID`
  until its row's `google_calendar_id` is set, other sectors have no calendar.

## Memberships (abonos)

A monthly plan (`services.billing = 'monthly'`) gives `classes_per_week` classes.
The decision record is [ADR 0011](adr/0011-memberships-as-materialized-bookings.md).

- **Pattern vs reservation.** `membership_slots` is the weekly pattern (weekday,
  time, bed; one per weekday). The reservation is one `bookings` row per
  occurrence (`bookings.membership_id`), with an explicit bed. Bed uniqueness
  and one-class-a-day are the SAME two invariants as any turno. Materializing
  takes the sector's `booking-sector:<id>` advisory lock, as
  `set_booking_sector` does, so a concurrent single booking sees the batch.
  A collision fails the whole signup with the occurrence in the error detail
  (`23P01` bed taken / `23505` same day).
- **Statuses.**

  | Membership | Meaning | Its classes |
  |---|---|---|
  | `pending` + hold | self-service signup, first cuota unpaid | `pending` with the same hold |
  | `pending`, no hold | booked by an admin, unpaid | `pending`, never swept |
  | `active` | paid at least once | `confirmed` |
  | `cancelled` | released by an admin or the client | later classes cancelled |
  | `expired` | hold lapsed, or ran past `ends_on` | — |

  Cuotas (`membership_periods`) are `pending` / `paid` / `void`.
- **Proration.** The first cuota is `round(price × classes left this month ÷
  classes in the whole month)`, both counted from the pattern. Example: price
  $40.000, Mon+Wed, starting Tue Oct 20 2026 → Wed 21, Mon 26, Wed 28 of 8 →
  $15.000. Any later month costs the plan's price, frozen when its row is
  created.
- **Renewal (`locked`).** A locked, active membership always has its current
  AND next local month materialized. `roll_memberships()` keeps it so, from
  `housekeeping()` and the daily `membership-cycle` cron. It runs under a
  try-lock and is idempotent (`unique (membership_id, period)`). If another
  turno took one of the member's beds next month, that member's roll is rolled
  back and recorded in `memberships.roll_error`. The admin sees it on Inicio,
  and the other members are unaffected. Locking later re-checks next month and
  refuses with `23P01` if a bed is taken. Unlocking ends the abono with the
  last paid month and cancels the rest.
- **Due day, surcharge, release.** Next month's cuota is due on `due_day`,
  inclusive. After that, `membership_periods_v` reports `is_late` and
  `amount_due_ars = round(amount × (1 + late_fee_pct/100))`. The surcharge is
  derived, never stored, and the first (prorated) cuota never gets one. From
  the day after `release_day`, `releasable` is true. That only enables
  "Liberar lugar" in the admin's overdue list; nothing is automatic and no
  reminder is sent. Every amount charged (Talo, receipt, cash) is
  `amount_due_ars`.
- **Paying.** A cuota is `payments.kind = 'membership'` with
  `membership_period_id` and `user_id`. It goes through the same settle paths
  as a booking: confirm first (`approve_membership_period`), then record the
  money. A cuota whose abono is gone records `paid_no_slot`. A second payment
  of a paid cuota records `duplicate_payment`. Cash at the desk is an approved
  `provider = 'cash'` row.
- **Release.** `release_membership` keeps every class in a paid month and
  cancels everything after it, voiding the unpaid cuotas.
- **One abono per client and sector** is checked in `create_membership`
  (`already_member`) but not constrained; see ADR 0011.
- **Cancelling a class** frees its bed and returns nothing. While the first
  cuota is unpaid, a client can't cancel single classes, only the whole signup.
- **Desk sales for clients without an account.** `admin-membership` creates a
  confirmed auth user with that email. The profile comes from
  `on_auth_user_created`, and the client is emailed to sign in with the usual
  code.

## Moving and swapping classes

Only abono classes, only `confirmed` ones, and only while BOTH the current and
the new time are at least `sectors.change_notice_hours` (24 h) away. Both must
fall in the same local week (Mon–Sun) and the same calendar month, so a paid
month's class never lands in an unpaid one.

- **Move** (`swap-booking` → `move`) updates the same row, so its turno page and
  emails follow it. `validateSlot` checks the hours, grid and lead; the EXCLUDE
  and the per-day index arbitrate. One conditional UPDATE re-asserts
  `confirmed` and the notice, so a race returns "Ya no se puede mover esta
  clase."
- **Swap** is propose → accept. `swap_requests` allows one pending offer per
  class. `swap_precheck` runs on propose and again on accept, and
  `expire_swap_requests` closes offers lazily once either class is no longer
  confirmed or is inside the notice. `swap_bookings` exchanges
  `starts_at/ends_at/resource_id`, and each row keeps its owner. Because
  `bookings_one_per_day` is a non-deferrable partial unique index, the swap
  first sets A to `expired` (outside the active predicates), moves B into A's
  slot, then moves A into B's slot with its status back. Other transactions
  block on the EXCLUDE recheck until commit, and any failure rolls everything
  back. A real conflict (one of them already has a class that day) surfaces as
  `23505` with `{"side":"a"|"b"}`.
- Clients can't read other clients' bookings or profiles. `swap_candidates` and
  `my_swap_requests` are `auth.uid()`-scoped definer functions that expose only
  time, bed, and first name + initial.
