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
| Within working days | — | `validateSlot` | non-working days disabled | — | "Ese día no está disponible para reservar." |
| Within working hours | — | `validateSlot` | only in-hours slots shown | — | "Ese horario está fuera del horario de atención." |
| Slot-grid aligned | — | `validateSlot` | only grid slots shown | — | "Ese horario no está disponible." |
| No Google freeBusy overlap (**best-effort**) | — (NOT in the EXCLUDE) | `validateSlot` over `getBusy()` | `availability` subtracts busy | — | "Ese horario ya no está disponible. Elegí otro." |

`validateSlot` and the working-window logic live in
`supabase/functions/_shared/booking-rules.ts` and are the **single source** used
by both `availability` (to generate slots) and `create-booking` (to re-validate
the submitted time), so the two cannot drift.

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

## Sectors and resources

A **sector** (`sectors`) is an area with its own agenda (`working_*`, `timezone`)
and policies (`lead_minutes`, `hold_minutes`, `cancel_notice_hours`). A plan
belongs to one sector; a turno occupies one **resource** (`resources`) of it.

- **Bed assignment.** Clients pick a time, never a resource. `availability` shows
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
