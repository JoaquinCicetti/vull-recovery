-- ============================================================================
-- Admin-defined slots and the client booking window (ADR 0012)
-- ============================================================================
-- Two changes to how a turno's time is decided:
--
--   1. The slot grid belongs to the admin, not to the plan. Each open range
--      (sector_hours) is cut into `slot_minutes` turnos from its `opens`, and a
--      turno occupies exactly ONE slot. services.duration_minutes stays as
--      information for the client (and the length of an abono class).
--   2. How far ahead clients may book is a sector policy: 'rolling' (the next
--      `rolling_days` days, what pilates keeps) or 'week' (the current Mon–Sun
--      week; the next one opens on `next_week_opens_dow` at
--      `next_week_opens_at` local time, Sunday 14:00 by default). Recovery
--      switches to 'week'.
--
-- Both are enforced at the edge (supabase/functions/_shared/booking-rules.ts
-- validateSlot), like the hours and the grid already were. No DB constraint:
-- the window depends on now(), and a grid trigger would tie existing rows to
-- config an admin can edit. Overlap and one-per-day stay the HARD invariants.
--
-- On apply every range gets the shortest active plan duration of its sector as
-- its slot length (the closest default to the 30-minute grid the owner wants).
-- From then on EVERY booking takes one slot of that length: a sector whose plans
-- are longer than its shortest one books those plans as shorter turnos, with
-- more of them per range. Set the slot length in Disponibilidad right after
-- applying.
-- Additive only; the new columns are covered by the existing RLS policies
-- (sectors_read / sectors_admin_write, sector_hours_read /
-- sector_hours_admin_write are row-level, not column-level).

-- ─── 1. slot length per open range ──────────────────────────────────────────
alter table public.sector_hours
  add column slot_minutes int not null default 30
    check (slot_minutes between 5 and 480);

update public.sector_hours h
   set slot_minutes = coalesce(
     (select min(s.duration_minutes) from public.services s
      where s.sector_id = h.sector_id and s.active),
     30);

-- ─── 2. booking window per sector ───────────────────────────────────────────
alter table public.sectors
  add column booking_window text not null default 'rolling'
    check (booking_window in ('rolling', 'week')),
  add column rolling_days int not null default 14
    check (rolling_days between 1 and 90),
  -- 0=Sun .. 6=Sat, a day of the CURRENT Mon–Sun week.
  add column next_week_opens_dow int not null default 0
    check (next_week_opens_dow between 0 and 6),
  add column next_week_opens_at time not null default '14:00';

update public.sectors set booking_window = 'week' where slug = 'recovery';

-- ─── 3. set_sector_hours takes the slot length ──────────────────────────────
-- p_hours = [{"weekday":1,"opens":"16:00","closes":"20:00","slot_minutes":30}, …].
-- A missing slot_minutes falls back to 30.
create or replace function public.set_sector_hours(p_sector uuid, p_hours jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) = 0 then
    raise exception 'Elegí al menos un día de atención.' using errcode = 'P0001';
  end if;

  delete from public.sector_hours where sector_id = p_sector;

  insert into public.sector_hours (sector_id, weekday, opens, closes, slot_minutes)
  select p_sector, h.weekday, h.opens, h.closes, coalesce(h.slot_minutes, 30)
  from jsonb_to_recordset(p_hours) as h(weekday int, opens time, closes time, slot_minutes int);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ─── 4. create_membership: abono times on the admin's grid ──────────────────
-- Verbatim from 20261015150000_memberships.sql except the outside_hours check:
-- a class starts on its range's slot grid and its plan's duration (or one slot,
-- whichever is longer) fits before the range closes. The class itself still
-- lasts the plan's duration (slot_occurrences / materialize are unchanged).
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
  -- Inside an open range of its weekday and on that range's slot grid, with
  -- the class (or one slot, if longer) fitting before it closes. (time - time
  -- is an interval, so a class running past midnight can never pass.)
  if exists (
    select 1 from jsonb_to_recordset(p_slots) sl(weekday int, start_time time, resource_id uuid)
    where not exists (
      select 1 from public.sector_hours h
      where h.sector_id = s.id and h.weekday = sl.weekday
        and sl.start_time >= h.opens
        and h.closes - sl.start_time
            >= make_interval(mins => greatest(h.slot_minutes, sv.duration_minutes))
        and (extract(epoch from sl.start_time - h.opens)::int % (h.slot_minutes * 60)) = 0
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
