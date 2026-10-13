-- ============================================================================
-- Sectors and resources: from "one room" to recovery + pilates + gym
-- ============================================================================
-- Until now the whole schema assumed ONE bookable room: one settings row, one
-- Google Calendar, and a no-overlap constraint across every turno. The business
-- is adding pilates (N beds, each with its own agenda, different policies) and a
-- gym, so:
--
--   sectors    an area of the business with its own agenda rules: hours, days,
--              calendar, notice periods. Recovery is the first one.
--   resources  the thing a turno occupies inside a sector. Recovery has one
--              ("Sala"); pilates will have one per bed. Each resource is its own
--              timeline — "N instances of the recovery agenda".
--
-- This migration is the FOUNDATION ONLY and changes no behaviour:
--   * every existing plan and turno is filed under the `recovery` sector and its
--     single resource;
--   * a BEFORE INSERT trigger fills sector/resource on new turnos, so the edge
--     functions (which do not know about sectors yet) keep working unmodified;
--   * the two invariants keep their names and error codes (23P01 / 23505), just
--     scoped: no overlap PER RESOURCE, one turno per day PER SECTOR.
-- `settings` is left in place and still read by the app; recovery's sector row
-- starts as a copy of it. The functions move to reading `sectors` next.

-- ─── sectors ────────────────────────────────────────────────────────────────
create table public.sectors (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique check (slug ~ '^[a-z][a-z0-9-]*$'),
  name                text not null,
  active              boolean not null default true,
  sort_order          int not null default 0,
  -- Agenda (what `settings` held for the single room).
  timezone            text not null default 'America/Argentina/Buenos_Aires',
  working_hours_start time not null default '09:00',
  working_hours_end   time not null default '18:00',
  working_days        int[] not null default '{1,2,3,4,5}',   -- 0=Sun .. 6=Sat
  -- The Google Calendar this sector's turnos are mirrored to (NULL = none).
  google_calendar_id  text,
  -- Policies. These were constants in code (LEAD_MINUTES, BOOKING_HOLD_MINUTES,
  -- the 24 h default of return_cancelled_booking); pilates needs its own.
  lead_minutes        int not null default 60  check (lead_minutes >= 0),
  hold_minutes        int not null default 10  check (hold_minutes > 0),
  cancel_notice_hours int not null default 24  check (cancel_notice_hours >= 0),
  -- Minimum notice to move a turno or swap it with another client.
  change_notice_hours int not null default 24  check (change_notice_hours >= 0),
  created_at          timestamptz not null default now()
);

alter table public.sectors enable row level security;
create policy sectors_read on public.sectors
  for select using (active or public.is_admin());
create policy sectors_admin_write on public.sectors
  for all using (public.is_admin()) with check (public.is_admin());

-- ─── resources ──────────────────────────────────────────────────────────────
create table public.resources (
  id         uuid primary key default gen_random_uuid(),
  sector_id  uuid not null references public.sectors(id) on delete cascade,
  name       text not null,
  active     boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (sector_id, name)
);
create index resources_sector_idx on public.resources (sector_id);

alter table public.resources enable row level security;
create policy resources_read on public.resources
  for select using (active or public.is_admin());
create policy resources_admin_write on public.resources
  for all using (public.is_admin()) with check (public.is_admin());

-- ─── recovery: the sector that already exists ───────────────────────────────
insert into public.sectors
  (slug, name, sort_order, timezone, working_hours_start, working_hours_end, working_days)
select 'recovery', 'Recovery', 0,
       s.timezone, s.working_hours_start, s.working_hours_end, s.working_days
from public.settings s
where s.id;

-- (A project with no settings row still gets its sector.)
insert into public.sectors (slug, name)
select 'recovery', 'Recovery'
where not exists (select 1 from public.sectors where slug = 'recovery');

insert into public.resources (sector_id, name)
select id, 'Sala' from public.sectors where slug = 'recovery';

-- ─── plans belong to a sector ───────────────────────────────────────────────
alter table public.services add column sector_id uuid references public.sectors(id);
update public.services
   set sector_id = (select id from public.sectors where slug = 'recovery');
alter table public.services alter column sector_id set not null;
create index services_sector_idx on public.services (sector_id);

-- New plans default to recovery until the admin UI asks for the sector.
create or replace function public.default_service_sector()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sector_id is null then
    select id into new.sector_id from public.sectors where slug = 'recovery';
  end if;
  return new;
end;
$$;
create trigger services_default_sector
  before insert on public.services
  for each row execute function public.default_service_sector();

-- ─── turnos occupy a resource ───────────────────────────────────────────────
alter table public.bookings
  add column sector_id   uuid references public.sectors(id),
  add column resource_id uuid references public.resources(id);

update public.bookings b
   set sector_id   = s.sector_id,
       resource_id = (select r.id from public.resources r
                      where r.sector_id = s.sector_id
                      order by r.sort_order, r.created_at limit 1)
  from public.services s
 where s.id = b.service_id;

alter table public.bookings
  alter column sector_id   set not null,
  alter column resource_id set not null;
create index bookings_resource_idx on public.bookings (resource_id, starts_at);

-- Fill sector/resource on insert. The sector ALWAYS comes from the plan (a turno
-- can never be filed under a sector its plan does not belong to). The resource
-- defaults to the sector's first active one — correct for a single-resource
-- sector like recovery; a multi-bed sector must pass resource_id explicitly, and
-- it is checked to belong to the sector.
create or replace function public.set_booking_sector()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select s.sector_id into new.sector_id
  from public.services s where s.id = new.service_id;

  if new.resource_id is null then
    select r.id into new.resource_id
    from public.resources r
    where r.sector_id = new.sector_id and r.active
    order by r.sort_order, r.created_at
    limit 1;
    if new.resource_id is null then
      raise exception 'El sector no tiene recursos activos' using errcode = 'P0001';
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
create trigger bookings_set_sector
  before insert or update of service_id, resource_id on public.bookings
  for each row execute function public.set_booking_sector();

-- ─── invariants, re-scoped (same names, same error codes) ───────────────────
-- No two ACTIVE turnos overlap on the same resource (was: anywhere).
alter table public.bookings drop constraint bookings_no_overlap;
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (resource_id with =, during with &&)
  where (status in ('pending','awaiting_payment','confirmed'));

-- One ACTIVE turno per client per local day, per sector (was: across everything)
-- — a client may do recovery and pilates on the same day.
drop index public.bookings_one_per_day;
create unique index bookings_one_per_day
  on public.bookings (user_id, sector_id, public.booking_local_date(starts_at))
  where status in ('pending','awaiting_payment','confirmed');

-- ─── Google sync state, per sector ──────────────────────────────────────────
-- calendar_sync was a singleton keyed `id = true`. The existing row keeps that
-- key and is tied to recovery; other sectors get their own row when their
-- calendar is connected.
alter table public.calendar_sync
  add column sector_id uuid unique references public.sectors(id) on delete cascade;
update public.calendar_sync
   set sector_id = (select id from public.sectors where slug = 'recovery');
