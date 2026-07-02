-- ============================================================================
-- One active booking per user per local day  (booking invariant)
-- ============================================================================
-- Product rule: a client may hold at most ONE turno per calendar day. The
-- bookings_no_overlap EXCLUDE constraint only blocks time OVERLAP between any
-- users — it has no per-user / per-day dimension, so this was unenforced.
--
-- Enforced race-safely at the DB layer (same reasoning as ADR 0007's EXCLUDE):
-- a partial UNIQUE index on (user_id, local-day) over the ACTIVE statuses. Two
-- concurrent create-booking calls for two different same-day slots can't both
-- win. Cancelled/expired rows drop out of the predicate and free the day
-- automatically — identical semantics to the overlap constraint.
--
-- "Active" == ('pending','awaiting_payment','confirmed'): the SAME set used by
-- bookings_no_overlap (init.sql), availability, the cancel CANCELLABLE list and
-- the create-payment payable check. These must stay in sync.

-- Buenos Aires local calendar date for an instant. Declared IMMUTABLE so it can
-- be used in an index expression. It uses a CONSTANT UTC-3 offset: Argentina
-- observes no DST today, so this is genuinely deterministic — unlike
-- `AT TIME ZONE 'America/Argentina/Buenos_Aires'` (STABLE, rejected by indexes)
-- or a bare `::date` cast (depends on the session TimeZone). If settings.timezone
-- is ever changed to a DST-observing zone this helper must be revisited — see
-- docs/booking-invariants.md.
create or replace function public.booking_local_date(ts timestamptz)
returns date
language sql
immutable
as $$
  select ((ts - interval '3 hours') at time zone 'UTC')::date;
$$;

-- Pre-launch reconciliation: existing data may already have >1 active booking per
-- user per local day, which would block the unique index below. Cancel all but the
-- best per (user, day) — confirmed > awaiting_payment > pending, then newest — so
-- the index can be created. No-op on a clean database.
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, public.booking_local_date(starts_at)
      order by
        case status when 'confirmed' then 0 when 'awaiting_payment' then 1 else 2 end,
        created_at desc
    ) as rn
  from public.bookings
  where status in ('pending', 'awaiting_payment', 'confirmed')
)
update public.bookings b
set status = 'cancelled',
    cancelled_at = now(),
    cancellation_reason = 'Depuración: dos turnos activos el mismo día'
from ranked r
where b.id = r.id and r.rn > 1;

-- At most one active booking per user per local day.
create unique index bookings_one_per_day
  on public.bookings (user_id, public.booking_local_date(starts_at))
  where status in ('pending','awaiting_payment','confirmed');
