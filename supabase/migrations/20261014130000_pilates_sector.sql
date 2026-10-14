-- ============================================================================
-- Pilates: the second sector, launched behind an admin-only flag
-- ============================================================================
-- Builds on 20261014120000_sectors_resources. Pilates has N beds. The client
-- picks a TIME and the server gives them the first free bed, so a pilates slot
-- stays open while any bed is free at that time.
--
-- The flag is `sectors.active`. An inactive sector, its plans and its turnos
-- exist but only admins can see or book them: RLS hides the sector and its plans
-- from everyone else, and the edge functions (which use the service role and so
-- skip RLS) check the same rule in _shared/sector.ts. Launching pilates means
-- turning on "Visible para clientes" in Admin → Disponibilidad.

-- ─── the sector, hidden ─────────────────────────────────────────────────────
-- Starts with recovery's agenda; the admin tunes it per sector.
insert into public.sectors
  (slug, name, active, sort_order, timezone, working_hours_start, working_hours_end, working_days)
select 'pilates', 'Pilates', false, 1,
       r.timezone, r.working_hours_start, r.working_hours_end, r.working_days
from public.sectors r
where r.slug = 'recovery'
on conflict (slug) do nothing;

insert into public.resources (sector_id, name, sort_order)
select id, 'Cama 1', 0 from public.sectors where slug = 'pilates'
on conflict (sector_id, name) do nothing;

-- ─── plans of a hidden sector are hidden too ────────────────────────────────
-- Was: `active or is_admin()`. The sector subquery runs under the caller's RLS
-- as well, so for a non-admin an inactive sector's row simply isn't there.
drop policy services_read on public.services;
create policy services_read on public.services
  for select using (
    public.is_admin()
    or (active and exists (
      select 1 from public.sectors s where s.id = sector_id and s.active
    ))
  );

-- ─── bed assignment: first FREE bed, not first bed ──────────────────────────
-- A turno inserted (or rescheduled) with resource_id NULL gets the first active
-- resource of its sector with no active turno overlapping it. Assignments in one
-- sector are serialized with a transaction-level advisory lock: without it, two
-- concurrent bookings for the same time would both see bed 1 free, and the
-- second would hit bookings_no_overlap although bed 2 is empty. Under READ
-- COMMITTED, the SELECT after the lock sees the row the previous holder
-- committed. bookings_no_overlap stays the race-safe arbiter.
--
-- No bed free → 23P01, the same code a taken slot raises, so every caller
-- already maps it to "Ese horario ya fue reservado".
create or replace function public.set_booking_sector()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select s.sector_id into new.sector_id
  from public.services s where s.id = new.service_id;

  if new.resource_id is null then
    if not exists (
      select 1 from public.resources r where r.sector_id = new.sector_id and r.active
    ) then
      raise exception 'El sector no tiene recursos activos' using errcode = 'P0001';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('booking-sector:' || new.sector_id::text, 0));

    select r.id into new.resource_id
    from public.resources r
    where r.sector_id = new.sector_id and r.active
      and not exists (
        select 1 from public.bookings b
        where b.resource_id = r.id
          and b.id <> new.id
          and b.status in ('pending','awaiting_payment','confirmed')
          and b.during && tstzrange(new.starts_at, new.ends_at, '[)')
      )
    order by r.sort_order, r.created_at
    limit 1;

    if new.resource_id is null then
      raise exception 'No hay lugar libre en ese horario' using errcode = '23P01';
    end if;
  elsif not exists (
    select 1 from public.resources r
    where r.id = new.resource_id and r.sector_id = new.sector_id
  ) then
    raise exception 'El recurso no pertenece al sector del plan' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Also re-run on a time change, so a reschedule that clears resource_id gets a
-- bed that is free at the NEW time (admin-booking does this).
drop trigger bookings_set_sector on public.bookings;
create trigger bookings_set_sector
  before insert or update of service_id, resource_id, starts_at, ends_at on public.bookings
  for each row execute function public.set_booking_sector();

-- ─── cancellation notice comes from the sector ──────────────────────────────
-- Same rule as 20261005120000_cancel_credit, but the client's minimum notice is
-- the sector's cancel_notice_hours instead of a fixed 24 h. p_min_notice still
-- overrides it when passed (no caller does today).
drop function public.return_cancelled_booking(uuid, boolean, interval);
create function public.return_cancelled_booking(
  p_booking_id uuid,
  p_by_admin   boolean,
  p_min_notice interval default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  b        public.bookings;
  consumed boolean;
  pay_id   uuid;
  v_reason text;
  v_notice interval;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.status <> 'cancelled' then return 'not_cancelled'; end if;

  select exists (
    select 1 from public.credit_ledger
    where booking_id = b.id and reason = 'booking_consume'
  ) into consumed;

  if not consumed then
    select id into pay_id from public.payments
    where booking_id = b.id and kind = 'booking'
      and status = 'approved' and reversed_at is null
    order by created_at desc
    limit 1;
    if pay_id is null then return 'unpaid'; end if;
  end if;

  select coalesce(p_min_notice, make_interval(hours => s.cancel_notice_hours))
    into v_notice
  from public.sectors s where s.id = b.sector_id;
  v_notice := coalesce(v_notice, interval '24 hours');

  if not p_by_admin
     and b.starts_at - coalesce(b.cancelled_at, now()) < v_notice then
    return 'late';
  end if;

  v_reason := case when consumed then 'booking_refund' else 'cancel_credit' end;
  insert into public.credit_ledger
    (user_id, service_id, delta, reason, booking_id, payment_id)
  values (b.user_id, b.service_id, 1, v_reason, b.id, pay_id)
  on conflict do nothing;
  if not found then return 'already'; end if;

  insert into public.user_credits (user_id, service_id, remaining)
  values (b.user_id, b.service_id, 1)
  on conflict (user_id, service_id) do update set
    remaining = public.user_credits.remaining + 1, updated_at = now();

  return 'credited';
end;
$$;

revoke execute on function public.return_cancelled_booking(uuid, boolean, interval)
  from public, anon, authenticated;
