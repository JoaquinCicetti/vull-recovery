-- ============================================================================
-- Memberships ("abonos"): a fixed weekly schedule, paid per calendar month
-- ============================================================================
-- A monthly plan (services.billing = 'monthly', 20261015130000) gives
-- `classes_per_week` classes. The client picks one time and one bed per chosen
-- weekday, and that pattern repeats every week of the month.
--
--   memberships         a client's abono of one plan. `locked` = renews every
--                       month with the same schedule and beds (a recurring
--                       member); unlocked = it ends with the month.
--   membership_slots    the weekly pattern: weekday, time, bed. A PATTERN, not a
--                       reservation.
--   membership_periods  one calendar month of a membership: classes, amount,
--                       due date, paid or not. The late surcharge is DERIVED
--                       (membership_periods_v), never stored.
--
-- THE RESERVATION IS THE BOOKINGS. Every occurrence of the pattern is an
-- ordinary bookings row (bookings.membership_id), so bookings_no_overlap stays
-- the one race-safe guarantee that a bed is never sold twice, and every existing
-- list, invariant and action (turno page, admin lists, cancel, reschedule) works
-- on classes unchanged. A locked active membership always has the current AND
-- next local month materialized (roll_memberships keeps it so); that is what
-- keeps next month's beds visibly taken for anybody else.
--
-- Statuses
--   membership pending   first cuota unpaid. hold_expires_at set (self-service):
--                        lapses like a booking hold. NULL hold = an admin booked
--                        it for the client: never swept, an admin releases it.
--   membership active    paid at least once.
--   cancelled / expired  released (admin or client) / ran out or hold lapsed.
--   bookings             pending (+ the membership's hold) while the membership
--                        is pending; confirmed once it is active.
--   period               pending | paid | void.
--
-- Deadlines are inclusive days of the month in the sector's timezone: a cuota is
-- due ON due_day (no surcharge that day), and an unpaid one is releasable the
-- day after release_day.

-- ─── tables ─────────────────────────────────────────────────────────────────
create table public.memberships (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  service_id      uuid not null references public.services(id),
  sector_id       uuid not null references public.sectors(id),
  status          text not null default 'pending'
                  check (status in ('pending', 'active', 'cancelled', 'expired')),
  locked          boolean not null default false,
  starts_on       date not null,
  ends_on         date,                    -- null = open-ended (locked)
  hold_expires_at timestamptz,             -- pending + null = admin-held
  -- The last failed roll (JSON text), cleared by the next successful one. A roll
  -- fails only when another turno took one of the member's beds next month.
  roll_error      text,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  cancelled_at    timestamptz,
  cancelled_by    uuid references public.profiles(id),
  cancel_reason   text,
  constraint memberships_dates check (ends_on is null or ends_on >= starts_on)
);
create index memberships_user_idx on public.memberships (user_id, sector_id);
create index memberships_roll_idx on public.memberships (sector_id)
  where status = 'active' and locked;
create index memberships_hold_idx on public.memberships (hold_expires_at)
  where status = 'pending' and hold_expires_at is not null;

create table public.membership_slots (
  id            uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id) on delete cascade,
  weekday       int  not null check (weekday between 0 and 6),
  start_time    time not null,
  resource_id   uuid not null references public.resources(id),
  -- "Never two classes the same day."
  unique (membership_id, weekday)
);

create table public.membership_periods (
  id            uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id) on delete cascade,
  period        date not null check (period = date_trunc('month', period::timestamp)::date),
  classes       int  not null check (classes >= 0),
  amount_ars    int  not null check (amount_ars >= 0),   -- base; surcharge is derived
  status        text not null default 'pending' check (status in ('pending', 'paid', 'void')),
  due_on        date not null,
  paid_at       timestamptz,
  payment_id    uuid references public.payments(id),
  created_at    timestamptz not null default now(),
  unique (membership_id, period)
);
create index membership_periods_due_idx on public.membership_periods (due_on)
  where status = 'pending';

alter table public.bookings
  add column membership_id uuid references public.memberships(id) on delete set null;
create index bookings_membership_idx on public.bookings (membership_id, starts_at)
  where membership_id is not null;

-- ─── payments: a third kind ─────────────────────────────────────────────────
alter table public.payments
  add column membership_period_id uuid references public.membership_periods(id);
alter table public.payments
  drop constraint payments_kind_check,
  add constraint payments_kind_check check (kind in ('booking', 'pack', 'membership')),
  drop constraint payments_shape_check,
  add constraint payments_shape_check check (
       (kind = 'booking'    and booking_id is not null)
    or (kind = 'pack'       and service_id is not null and user_id is not null)
    or (kind = 'membership' and membership_period_id is not null and user_id is not null)
  );
-- Same reuse-first guarantee bookings and packs have: one live CVU per cuota.
create unique index payments_talo_live_membership_uniq
  on public.payments (membership_period_id)
  where provider = 'talo' and status = 'pending' and membership_period_id is not null;
create index payments_period_idx on public.payments (membership_period_id)
  where membership_period_id is not null;
-- payments_select_own already lets a client read rows with user_id = auth.uid().

-- ─── RLS: read own (or admin); every write goes through the functions ───────
alter table public.memberships enable row level security;
create policy memberships_select_own on public.memberships
  for select using (user_id = auth.uid() or public.is_admin());

alter table public.membership_slots enable row level security;
create policy membership_slots_select_own on public.membership_slots
  for select using (exists (
    select 1 from public.memberships m
    where m.id = membership_id and (m.user_id = auth.uid() or public.is_admin())
  ));

alter table public.membership_periods enable row level security;
create policy membership_periods_select_own on public.membership_periods
  for select using (exists (
    select 1 from public.memberships m
    where m.id = membership_id and (m.user_id = auth.uid() or public.is_admin())
  ));

-- ─── the surcharge, derived ─────────────────────────────────────────────────
-- security_invoker: the caller's RLS on the base tables applies, so a client
-- sees only their own periods. The first (prorated) period is never surcharged:
-- it is paid at signup, and an unpaid self-service one simply lapses.
create view public.membership_periods_v
with (security_invoker = true) as
with base as (
  select p.*,
         m.user_id, m.service_id, m.sector_id, m.locked, m.starts_on,
         m.status as membership_status,
         s.due_day, s.late_fee_pct, s.release_day,
         (now() at time zone s.timezone)::date as local_today,
         p.period > date_trunc('month', m.starts_on)::date as late_fee_applies
  from public.membership_periods p
  join public.memberships m on m.id = p.membership_id
  join public.sectors s on s.id = m.sector_id
)
select b.id, b.membership_id, b.period, b.classes, b.amount_ars, b.status, b.due_on,
       b.paid_at, b.payment_id, b.created_at,
       b.user_id, b.service_id, b.sector_id, b.locked, b.membership_status,
       b.late_fee_pct, b.local_today,
       (b.status = 'pending' and b.late_fee_applies and b.local_today > b.due_on) as is_late,
       case when b.status = 'pending' and b.late_fee_applies and b.local_today > b.due_on
            then round(b.amount_ars * (1 + b.late_fee_pct / 100.0))::int
            else b.amount_ars end as amount_due_ars,
       greatest(0, b.local_today - b.due_on) as days_late,
       (b.status = 'pending'
        and b.local_today > b.due_on
        and b.local_today > greatest(
              make_date(extract(year from b.period)::int,
                        extract(month from b.period)::int, b.release_day),
              b.due_on + (b.release_day - b.due_day))) as releasable
from base b;

-- ─── helpers ────────────────────────────────────────────────────────────────
create or replace function public.month_end(d date)
returns date
language sql
immutable
as $$
  select (date_trunc('month', d::timestamp) + interval '1 month - 1 day')::date;
$$;

-- Every occurrence of a weekly pattern between two local dates (inclusive), as
-- instants in the sector's timezone. The ONE generator behind pricing and
-- materialization. p_slots = [{"weekday":1,"start_time":"10:00","resource_id":…}].
create or replace function public.slot_occurrences(
  p_sector     uuid,
  p_slots      jsonb,
  p_from       date,
  p_to         date,
  p_duration   int,
  p_not_before timestamptz default null
)
returns table (
  weekday     int,
  start_time  time,
  resource_id uuid,
  on_date     date,
  starts_at   timestamptz,
  ends_at     timestamptz
)
language sql
stable
set search_path = public
as $$
  select sl.weekday, sl.start_time, sl.resource_id, d::date,
         (d::date + sl.start_time) at time zone s.timezone,
         ((d::date + sl.start_time) at time zone s.timezone) + make_interval(mins => p_duration)
  from public.sectors s
  cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d
  join jsonb_to_recordset(p_slots) as sl(weekday int, start_time time, resource_id uuid)
    on sl.weekday = extract(dow from d)::int
  where s.id = p_sector
    and ((d::date + sl.start_time) at time zone s.timezone)
        >= coalesce(p_not_before, '-infinity'::timestamptz)
  order by 4, 2;
$$;

create or replace function public.membership_slots_json(p_membership uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'weekday', weekday, 'start_time', start_time, 'resource_id', resource_id)),
         '[]'::jsonb)
  from public.membership_slots where membership_id = p_membership;
$$;

-- ─── materialize one month of a membership into bookings ────────────────────
-- Takes the SAME advisory lock as set_booking_sector, so a concurrent one-off
-- booking that lets the DB pick a bed waits for this batch and then sees its
-- beds taken (instead of picking one of them and failing on the EXCLUDE).
-- Any collision fails the whole transaction with the occurrence in DETAIL:
--   23P01 bed_taken  {weekday,start_time,resource_id,resource_name,on_date}
--   23505 same_day   {on_date}
create or replace function public.materialize_membership_period(
  p_membership uuid,
  p_period     date
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  m        public.memberships;
  v_dur    int;
  v_lead   int;
  v_status public.booking_status;
  v_from   date;
  v_to     date;
  occ      record;
  n        int := 0;
begin
  select * into m from public.memberships where id = p_membership;
  if not found then raise exception 'membership_not_found' using errcode = 'P0001'; end if;
  select sv.duration_minutes, s.lead_minutes into v_dur, v_lead
  from public.services sv join public.sectors s on s.id = sv.sector_id
  where sv.id = m.service_id;

  perform pg_advisory_xact_lock(hashtextextended('booking-sector:' || m.sector_id::text, 0));

  v_status := case when m.status = 'active' then 'confirmed' else 'pending' end;
  v_from := greatest(m.starts_on, p_period);
  v_to := least(coalesce(m.ends_on, 'infinity'::date), public.month_end(p_period));

  for occ in
    select o.*, r.name as resource_name
    from public.slot_occurrences(m.sector_id, public.membership_slots_json(m.id),
                                 v_from, v_to, v_dur, now() + make_interval(mins => v_lead)) o
    join public.resources r on r.id = o.resource_id
  loop
    begin
      insert into public.bookings
        (user_id, service_id, resource_id, membership_id, starts_at, ends_at, status,
         hold_expires_at)
      values
        (m.user_id, m.service_id, occ.resource_id, m.id, occ.starts_at, occ.ends_at, v_status,
         case when v_status = 'pending' then m.hold_expires_at end);
    exception
      when exclusion_violation then
        raise exception 'bed_taken' using errcode = '23P01', detail = jsonb_build_object(
          'weekday', occ.weekday, 'start_time', to_char(occ.start_time, 'HH24:MI'),
          'resource_id', occ.resource_id, 'resource_name', occ.resource_name,
          'on_date', occ.on_date)::text;
      when unique_violation then
        raise exception 'same_day' using errcode = '23505', detail = jsonb_build_object(
          'on_date', occ.on_date)::text;
    end;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ─── make sure one month exists (period + bookings) ─────────────────────────
-- Idempotent: false when the period already exists. Amount = price prorated by
-- the classes still ahead (lead time applied) over the classes of the whole
-- month, which is the full price for any month that has not started. Collisions
-- propagate (see materialize_membership_period).
create or replace function public.ensure_membership_period(
  p_membership uuid,
  p_period     date,
  p_due_on     date default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  m        public.memberships;
  sv       public.services;
  s        public.sectors;
  v_slots  jsonb;
  v_left   int;
  v_full   int;
  v_amount int;
  v_id     uuid;
begin
  select * into m from public.memberships where id = p_membership;
  select * into sv from public.services where id = m.service_id;
  select * into s from public.sectors where id = m.sector_id;
  if m.ends_on is not null and m.ends_on < p_period then return false; end if;
  -- A live period means the month is already there. A VOID one (unlocked, then
  -- locked again) is revived below; payments may reference it, so it is reused
  -- rather than deleted.
  if exists (select 1 from public.membership_periods
             where membership_id = m.id and period = p_period and status <> 'void') then
    return false;
  end if;

  v_slots := public.membership_slots_json(m.id);
  select count(*) into v_left
  from public.slot_occurrences(s.id, v_slots, greatest(m.starts_on, p_period),
                               least(coalesce(m.ends_on, 'infinity'::date), public.month_end(p_period)),
                               sv.duration_minutes, now() + make_interval(mins => s.lead_minutes));
  if v_left = 0 then return false; end if;
  select count(*) into v_full
  from public.slot_occurrences(s.id, v_slots, p_period, public.month_end(p_period),
                               sv.duration_minutes, null);
  v_amount := case when v_left >= v_full then sv.price_ars
                   else round(sv.price_ars::numeric * v_left / v_full)::int end;

  insert into public.membership_periods (membership_id, period, classes, amount_ars, due_on)
  values (m.id, p_period, v_left, v_amount,
          coalesce(p_due_on, p_period + (s.due_day - 1)))
  on conflict (membership_id, period) do update
    set status = 'pending', classes = excluded.classes, amount_ars = excluded.amount_ars,
        due_on = excluded.due_on, paid_at = null, payment_id = null
    where public.membership_periods.status = 'void'
  returning id into v_id;
  if v_id is null then return false; end if;

  perform public.materialize_membership_period(m.id, p_period);
  return true;
end;
$$;

-- First day of the month after "today" in the membership's sector.
create or replace function public.membership_next_period(p_sector uuid)
returns date
language sql
stable
set search_path = public
as $$
  select (date_trunc('month', (now() at time zone s.timezone)::date) + interval '1 month')::date
  from public.sectors s where s.id = p_sector;
$$;

-- ─── create ─────────────────────────────────────────────────────────────────
-- Business errors (P0001, message = token): not_monthly, slot_count_mismatch,
-- duplicate_weekday, bad_resource, outside_hours, bad_start, no_classes,
-- already_member. Collisions: 23P01 / 23505 with detail (see materialize).
-- p_hold null = admin-held (never swept). p_paid_cash = the admin collected the
-- first cuota in cash: recorded as a payment and the membership is active.
create or replace function public.create_membership(
  p_user       uuid,
  p_service    uuid,
  p_slots      jsonb,
  p_locked     boolean,
  p_starts_on  date,
  p_hold       interval,
  p_created_by uuid,
  p_paid_cash  boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sv       public.services;
  s        public.sectors;
  v_today  date;
  v_start  date;
  v_p1     date;
  v_left   int;
  m        public.memberships;
  v_period uuid;
begin
  select * into sv from public.services where id = p_service;
  if not found or not sv.active or sv.billing <> 'monthly' then
    raise exception 'not_monthly' using errcode = 'P0001';
  end if;
  select * into s from public.sectors where id = sv.sector_id;
  v_today := (now() at time zone s.timezone)::date;

  -- ── the pattern ──
  if jsonb_typeof(p_slots) is distinct from 'array'
     or jsonb_array_length(p_slots) <> sv.classes_per_week then
    raise exception 'slot_count_mismatch' using errcode = 'P0001';
  end if;
  if (select count(distinct (e ->> 'weekday')) from jsonb_array_elements(p_slots) e)
     <> jsonb_array_length(p_slots) then
    raise exception 'duplicate_weekday' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_slots) sl(weekday int, start_time time, resource_id uuid)
    where sl.weekday is null or sl.weekday not between 0 and 6 or sl.start_time is null
       or not exists (select 1 from public.resources r
                      where r.id = sl.resource_id and r.sector_id = s.id and r.active)
  ) then
    raise exception 'bad_resource' using errcode = 'P0001';
  end if;
  -- Inside an open range of its weekday and on that range's grid. (time - time
  -- is an interval, so a class running past midnight can never pass.)
  if exists (
    select 1 from jsonb_to_recordset(p_slots) sl(weekday int, start_time time, resource_id uuid)
    where not exists (
      select 1 from public.sector_hours h
      where h.sector_id = s.id and h.weekday = sl.weekday
        and sl.start_time >= h.opens
        and h.closes - sl.start_time >= make_interval(mins => sv.duration_minutes)
        and (extract(epoch from sl.start_time - h.opens)::int % (sv.duration_minutes * 60)) = 0
    )
  ) then
    raise exception 'outside_hours' using errcode = 'P0001';
  end if;

  -- ── when ──
  v_start := coalesce(p_starts_on, v_today);
  if v_start < v_today or v_start > public.membership_next_period(s.id) then
    raise exception 'bad_start' using errcode = 'P0001';
  end if;
  v_p1 := date_trunc('month', v_start)::date;
  select count(*) into v_left
  from public.slot_occurrences(s.id, p_slots, v_start, public.month_end(v_p1),
                               sv.duration_minutes, now() + make_interval(mins => s.lead_minutes));
  if v_left = 0 then
    -- Nothing left this month on that schedule. A recurring member simply
    -- starts next month; a one-month abono has nothing to sell.
    if p_locked and v_p1 < public.membership_next_period(s.id) then
      v_start := public.membership_next_period(s.id);
      v_p1 := v_start;
    else
      raise exception 'no_classes' using errcode = 'P0001';
    end if;
  end if;

  -- Not race-safe (two clicks in different weekdays): bookings_one_per_day
  -- backstops same-weekday duplicates; see docs/booking-invariants.md.
  if exists (
    select 1 from public.memberships x
    where x.user_id = p_user and x.sector_id = s.id and x.status in ('pending', 'active')
      and (x.ends_on is null or x.ends_on >= v_start)
  ) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  insert into public.memberships
    (user_id, service_id, sector_id, status, locked, starts_on, ends_on, hold_expires_at,
     created_by)
  values
    (p_user, sv.id, s.id, 'pending', p_locked, v_start,
     case when p_locked then null else public.month_end(v_p1) end,
     case when p_paid_cash or p_hold is null then null else now() + p_hold end,
     p_created_by)
  returning * into m;

  insert into public.membership_slots (membership_id, weekday, start_time, resource_id)
  select m.id, sl.weekday, sl.start_time, sl.resource_id
  from jsonb_to_recordset(p_slots) sl(weekday int, start_time time, resource_id uuid);

  -- First month: due today. A recurring member also gets next month now, so its
  -- beds are taken from the start (the preview showed them free for both).
  perform public.ensure_membership_period(m.id, v_p1, v_today);
  if p_locked and public.membership_next_period(s.id) > v_p1 then
    perform public.ensure_membership_period(m.id, public.membership_next_period(s.id));
  end if;

  select id into v_period from public.membership_periods
  where membership_id = m.id and period = v_p1;

  if p_paid_cash then
    perform public.pay_period_cash(v_period, p_created_by);
  end if;

  return jsonb_build_object(
    'membership', (select to_jsonb(x) from public.memberships x where x.id = m.id),
    'period', (select to_jsonb(v) from public.membership_periods_v v where v.id = v_period),
    'bookings', (select count(*) from public.bookings b where b.membership_id = m.id)
  );
end;
$$;

-- ─── approve (money arrived) ────────────────────────────────────────────────
-- 'ok' | 'already' | 'no_slot' | 'not_found'. no_slot = the membership is gone
-- (hold lapsed, released): the caller records the money with
-- admin_flag = 'paid_no_slot', exactly like an unconfirmable booking.
-- Confirms every pending class of the membership (a recurring member's next
-- month was materialized at signup), then rolls next month for a recurring
-- member; a roll collision is recorded, it never undoes the payment.
create or replace function public.approve_membership_period(
  p_period  uuid,
  p_payment uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  per     public.membership_periods;
  m       public.memberships;
  v_det   text;
begin
  select * into per from public.membership_periods where id = p_period for update;
  if not found then return 'not_found'; end if;
  if per.status = 'paid' then return 'already'; end if;
  select * into m from public.memberships where id = per.membership_id for update;
  if per.status = 'void' or m.status not in ('pending', 'active') then return 'no_slot'; end if;

  update public.bookings
     set status = 'confirmed', hold_expires_at = null
   where membership_id = m.id and status in ('pending', 'awaiting_payment');

  update public.membership_periods
     set status = 'paid', paid_at = now(), payment_id = p_payment
   where id = per.id;
  update public.memberships
     set status = 'active', hold_expires_at = null
   where id = m.id;

  if m.locked then
    begin
      perform public.ensure_membership_period(m.id, public.membership_next_period(m.sector_id));
      update public.memberships set roll_error = null where id = m.id and roll_error is not null;
    exception when others then
      get stacked diagnostics v_det = pg_exception_detail;
      update public.memberships
         set roll_error = jsonb_build_object('at', now(), 'error', sqlerrm, 'detail', v_det)::text
       where id = m.id;
    end;
  end if;
  return 'ok';
end;
$$;

-- ─── cash at the desk ───────────────────────────────────────────────────────
-- Records the cuota (surcharge included when late) as an approved cash payment,
-- then approves the period. Same return values as approve_membership_period.
create or replace function public.pay_period_cash(p_period uuid, p_admin uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v      public.membership_periods_v;
  v_pay  uuid;
begin
  perform 1 from public.membership_periods where id = p_period for update;
  select * into v from public.membership_periods_v where id = p_period;
  if not found then return 'not_found'; end if;
  if v.status = 'paid' then return 'already'; end if;
  if v.status = 'void' or v.membership_status not in ('pending', 'active') then
    return 'no_slot';
  end if;

  insert into public.payments
    (kind, membership_period_id, user_id, provider, amount_ars, status, raw)
  values
    ('membership', p_period, v.user_id, 'cash', v.amount_due_ars, 'approved',
     jsonb_build_object('recorded_by', p_admin, 'recorded_at', now()))
  returning id into v_pay;

  return public.approve_membership_period(p_period, v_pay);
end;
$$;

-- ─── release ("Liberar lugar", "dar de baja") ───────────────────────────────
-- Stops the membership at the end of what was paid: classes in paid months stay,
-- every later class is cancelled (its bed frees up), unpaid periods are voided.
-- Returns the number of classes cancelled.
create or replace function public.release_membership(
  p_membership uuid,
  p_by         uuid,
  p_reason     text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  m      public.memberships;
  v_tz   text;
  v_keep date;
  n      int;
begin
  select * into m from public.memberships where id = p_membership for update;
  if not found or m.status not in ('pending', 'active') then
    raise exception 'not_active' using errcode = 'P0001';
  end if;
  select timezone into v_tz from public.sectors where id = m.sector_id;
  select max(public.month_end(period)) into v_keep
  from public.membership_periods where membership_id = m.id and status = 'paid';
  v_keep := coalesce(v_keep, m.starts_on - 1);

  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by,
         cancellation_reason = coalesce(p_reason, 'Abono liberado'), hold_expires_at = null
   where membership_id = m.id
     and status in ('pending', 'awaiting_payment', 'confirmed')
     and (starts_at at time zone v_tz)::date > v_keep;
  get diagnostics n = row_count;

  update public.membership_periods set status = 'void'
   where membership_id = m.id and status = 'pending';

  update public.memberships
     set status = 'cancelled', locked = false, ends_on = greatest(v_keep, m.starts_on),
         hold_expires_at = null, cancelled_at = now(), cancelled_by = p_by,
         cancel_reason = p_reason
   where id = m.id;
  return n;
end;
$$;

-- ─── lock / unlock ──────────────────────────────────────────────────────────
-- Lock: open-ended + next month materialized NOW, without catching collisions:
-- a bed someone else took next month raises 23P01 with the occurrence in detail
-- and nothing changes. Unlock: ends with the last month that is paid (or, while
-- the first cuota is unpaid, with the first month); later classes are cancelled
-- and later cuotas voided.
create or replace function public.set_membership_locked(
  p_membership uuid,
  p_locked     boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m      public.memberships;
  v_tz   text;
  v_keep date;
  v_today date;
begin
  select * into m from public.memberships where id = p_membership for update;
  if not found or m.status not in ('pending', 'active') then
    raise exception 'not_active' using errcode = 'P0001';
  end if;
  select timezone into v_tz from public.sectors where id = m.sector_id;
  v_today := (now() at time zone v_tz)::date;

  if p_locked then
    if m.ends_on is not null and m.ends_on < v_today then
      raise exception 'not_active' using errcode = 'P0001';
    end if;
    update public.memberships set locked = true, ends_on = null where id = m.id;
    perform public.ensure_membership_period(m.id, public.membership_next_period(m.sector_id));
  else
    select max(public.month_end(period)) into v_keep
    from public.membership_periods where membership_id = m.id and status = 'paid';
    v_keep := greatest(coalesce(v_keep, m.starts_on),
                       public.month_end(date_trunc('month', m.starts_on)::date));
    update public.bookings
       set status = 'cancelled', cancelled_at = now(),
           cancellation_reason = 'Abono sin renovación', hold_expires_at = null
     where membership_id = m.id
       and status in ('pending', 'awaiting_payment', 'confirmed')
       and starts_at > now()
       and (starts_at at time zone v_tz)::date > v_keep;
    update public.membership_periods set status = 'void'
     where membership_id = m.id and status = 'pending' and period > v_keep;
    update public.memberships set locked = false, ends_on = v_keep where id = m.id;
  end if;
  return (select to_jsonb(x) from public.memberships x where x.id = m.id);
end;
$$;

-- ─── client abandons an unpaid signup ───────────────────────────────────────
create or replace function public.cancel_pending_membership(
  p_membership uuid,
  p_user       uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.memberships;
begin
  select * into m from public.memberships where id = p_membership for update;
  if not found or m.user_id <> p_user then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;
  if m.status <> 'pending' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_user,
         cancellation_reason = 'Abono cancelado antes de pagar', hold_expires_at = null
   where membership_id = m.id and status in ('pending', 'awaiting_payment', 'confirmed');
  update public.membership_periods set status = 'void'
   where membership_id = m.id and status = 'pending';
  update public.memberships
     set status = 'cancelled', hold_expires_at = null, cancelled_at = now(),
         cancelled_by = p_user, cancel_reason = 'Cancelado por el cliente antes de pagar'
   where id = m.id;
end;
$$;

-- ─── lazy maintenance ───────────────────────────────────────────────────────
-- A lapsed self-service signup expires with its classes and cuota; an abono
-- whose last class is past ends.
create or replace function public.expire_memberships()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  with gone as (
    update public.memberships set status = 'expired'
     where status = 'pending' and hold_expires_at < now()
    returning id
  ), b as (
    update public.bookings set status = 'expired'
     where membership_id in (select id from gone) and status = 'pending'
    returning 1
  ), p as (
    update public.membership_periods set status = 'void'
     where membership_id in (select id from gone) and status = 'pending'
    returning 1
  )
  select count(*) into n from gone;

  update public.memberships m set status = 'expired'
    from public.sectors s
   where s.id = m.sector_id and m.status = 'active' and m.ends_on is not null
     and m.ends_on < (now() at time zone s.timezone)::date;
  return n;
end;
$$;

-- Keep every recurring member's current and next month materialized. Called
-- lazily (housekeeping) and by the membership-cycle cron; try-lock so concurrent
-- callers don't both do the work. One member's collision is recorded on its row
-- and never blocks the others.
create or replace function public.roll_memberships(p_sector uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r      record;
  v_cur  date;
  v_det  text;
  n      int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('membership-roll', 0)) then
    return 0;
  end if;
  for r in
    select m.id, m.sector_id, s.timezone
    from public.memberships m join public.sectors s on s.id = m.sector_id
    where m.status = 'active' and m.locked and m.ends_on is null
      and (p_sector is null or m.sector_id = p_sector)
      and not exists (
        select 1 from public.membership_periods p
        where p.membership_id = m.id
          and p.period = public.membership_next_period(m.sector_id)
          and p.status <> 'void'
      )
  loop
    v_cur := date_trunc('month', (now() at time zone r.timezone)::date)::date;
    begin
      if public.ensure_membership_period(r.id, v_cur) then n := n + 1; end if;
      if public.ensure_membership_period(r.id, public.membership_next_period(r.sector_id)) then
        n := n + 1;
      end if;
      update public.memberships set roll_error = null where id = r.id and roll_error is not null;
    exception when others then
      get stacked diagnostics v_det = pg_exception_detail;
      update public.memberships
         set roll_error = jsonb_build_object('at', now(), 'error', sqlerrm, 'detail', v_det)::text
       where id = r.id;
    end;
  end loop;
  return n;
end;
$$;

-- Everything lazy, in one round trip: the booking hold sweep that availability
-- and create-booking used to run inline, membership expiry and the roll.
-- (20261015160000 redefines it to also expire swap requests.)
create or replace function public.housekeeping()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mem   int;
  v_holds int;
  v_roll  int;
begin
  v_mem := public.expire_memberships();
  update public.bookings set status = 'expired'
   where status = 'pending' and hold_expires_at < now();
  get diagnostics v_holds = row_count;
  v_roll := public.roll_memberships(null);
  return jsonb_build_object('holds', v_holds, 'memberships', v_mem, 'rolled', v_roll);
end;
$$;

-- The admin dashboard runs under RLS (no service role in Next), so it gets its
-- own gated entry point to the same maintenance.
create or replace function public.admin_membership_cycle()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.housekeeping() || jsonb_build_object(
    'roll_errors', (select count(*) from public.memberships
                    where roll_error is not null and status = 'active'));
end;
$$;

-- ─── privileges ─────────────────────────────────────────────────────────────
-- Everything that takes the acting user as a parameter is service-role only
-- (see 20260824120000_revoke_public_rpc.sql for why PUBLIC must be revoked).
revoke execute on function public.slot_occurrences(uuid, jsonb, date, date, int, timestamptz) from public, anon, authenticated;
revoke execute on function public.membership_slots_json(uuid) from public, anon, authenticated;
revoke execute on function public.materialize_membership_period(uuid, date) from public, anon, authenticated;
revoke execute on function public.ensure_membership_period(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.membership_next_period(uuid) from public, anon, authenticated;
revoke execute on function public.create_membership(uuid, uuid, jsonb, boolean, date, interval, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.approve_membership_period(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.pay_period_cash(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.release_membership(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.set_membership_locked(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.cancel_pending_membership(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.expire_memberships() from public, anon, authenticated;
revoke execute on function public.roll_memberships(uuid) from public, anon, authenticated;
revoke execute on function public.housekeeping() from public, anon, authenticated;
revoke execute on function public.admin_membership_cycle() from public, anon;
grant  execute on function public.admin_membership_cycle() to authenticated;

do $$
declare
  fn   text;
  role text;
  fns  text[] := array[
    'public.slot_occurrences(uuid, jsonb, date, date, int, timestamptz)',
    'public.materialize_membership_period(uuid, date)',
    'public.ensure_membership_period(uuid, date, date)',
    'public.create_membership(uuid, uuid, jsonb, boolean, date, interval, uuid, boolean)',
    'public.approve_membership_period(uuid, uuid)',
    'public.pay_period_cash(uuid, uuid)',
    'public.release_membership(uuid, uuid, text)',
    'public.set_membership_locked(uuid, boolean)',
    'public.cancel_pending_membership(uuid, uuid)',
    'public.roll_memberships(uuid)',
    'public.housekeeping()'
  ];
begin
  foreach fn in array fns loop
    foreach role in array array['anon', 'authenticated'] loop
      if has_function_privilege(role, fn, 'execute') then
        raise exception 'privilege leak: % can execute %', role, fn;
      end if;
    end loop;
  end loop;
  if has_function_privilege('anon', 'public.admin_membership_cycle()', 'execute') then
    raise exception 'privilege leak: anon can execute admin_membership_cycle()';
  end if;
end;
$$;
