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

| Invariant | DB layer | Edge layer (`create-booking`) | Client UX | PG code | Message (es) |
|-----------|----------|-------------------------------|-----------|---------|--------------|
| **No time overlap** (HARD) | `bookings_no_overlap` EXCLUDE gist on `during` | `23P01` → 409 | `availability` hides taken slots | `23P01` | "Ese horario ya fue reservado. Elegí otro." |
| **Max 1 turno per local day per user** (HARD) | `bookings_one_per_day` partial UNIQUE on `(user_id, booking_local_date(starts_at))` | pre-check query + `23505` → 409 | booked days disabled in the calendar | `23505` | "Ya tenés un turno reservado para ese día. Cancelalo si querés elegir otro horario." |
| `ends_at > starts_at` (HARD) | `bookings_time_valid` CHECK | (n/a) | (n/a) | `23514` | — |
| No past slot | — | `start < now` → 400 | past days not shown | — | "Ese horario ya pasó" |
| Lead time ≥ 60 min | — | `validateSlot` | earliest filter | — | "Necesitás reservar con al menos una hora de anticipación." |
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
`confirmed`**. The exact same set is used by every guard — keep them in sync:

- `bookings_no_overlap` EXCLUDE predicate (init migration)
- `bookings_one_per_day` partial-index predicate
- `availability` active-bookings query and `create-booking` per-day pre-check
- `cancel-booking` `CANCELLABLE`
- `create-payment` payable check

Cancelling or expiring a booking drops it out of these predicates, freeing both
the slot and the day automatically.

## Holds

A new booking is `pending` with `hold_expires_at`. Expired **pending** holds are
freed **lazily** (no cron) at the start of `availability` and `create-booking`.
Canonical hold duration is **10 minutes** (`BOOKING_HOLD_MINUTES`); the code
default is currently `20` — set the env var in production to match. The
server-authoritative countdown UI reads `hold_expires_at` directly, so it always
agrees with the DB regardless of the constant.

**Caveat:** `awaiting_payment` holds (a started Mobbex checkout or an uploaded
manual receipt) currently never auto-expire, so they hold their slot and day
until paid, cancelled, or admin-resolved. An expiry/SLA for unverified
`awaiting_payment` is tracked in `docs/audit-and-roadmap.md`.

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
