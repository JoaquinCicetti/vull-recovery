-- ============================================================================
-- Per-weekday opening hours: sector_hours replaces working_hours_* / working_days
-- ============================================================================
-- A sector used to have ONE open/close time shared by every working day. Pilates
-- needs different hours per weekday (and more than one range on a day: morning
-- and evening, closed at noon), so the agenda moves to rows:
--
--   sector_hours  one open range of one weekday. A weekday with no rows is
--                 closed. Ranges of the same weekday never overlap (EXCLUDE).
--
-- The class/turno grid aligns to each range's `opens` (see
-- supabase/functions/_shared/booking-rules.ts workingWindows / validateSlot).
-- Every sector is seeded with exactly the agenda it had, so availability is
-- unchanged until an admin edits it. The old columns are dropped: two sources of
-- truth for "when is it open" would drift.

create type public.timerange as range (subtype = time);

create table public.sector_hours (
  id         uuid primary key default gen_random_uuid(),
  sector_id  uuid not null references public.sectors(id) on delete cascade,
  -- 0=Sun .. 6=Sat: the same numbering as extract(dow) and JS getUTCDay().
  weekday    int  not null check (weekday between 0 and 6),
  opens      time not null,
  closes     time not null,
  created_at timestamptz not null default now(),
  constraint sector_hours_order check (closes > opens),
  -- '[)' so 08:00–12:00 and 12:00–13:00 may touch.
  constraint sector_hours_no_overlap exclude using gist (
    sector_id with =,
    weekday with =,
    public.timerange(opens, closes, '[)') with &&
  )
);
create index sector_hours_sector_idx on public.sector_hours (sector_id, weekday, opens);

alter table public.sector_hours enable row level security;
-- Readable exactly when the sector row is: the subquery runs under the caller's
-- RLS, so a hidden sector's hours are admins-only too (same trick as services_read).
create policy sector_hours_read on public.sector_hours
  for select using (exists (select 1 from public.sectors s where s.id = sector_id));
create policy sector_hours_admin_write on public.sector_hours
  for all using (public.is_admin()) with check (public.is_admin());

-- ─── seed from the old columns, then drop them ──────────────────────────────
insert into public.sector_hours (sector_id, weekday, opens, closes)
select s.id, d, s.working_hours_start, s.working_hours_end
from public.sectors s, unnest(s.working_days) as d
where s.working_hours_end > s.working_hours_start;

alter table public.sectors
  drop column working_hours_start,
  drop column working_hours_end,
  drop column working_days;

-- ─── admin: replace a sector's whole agenda atomically ──────────────────────
-- The admin form edits the week as one thing. Deleting and re-inserting from the
-- browser would be two requests, and a failure between them leaves the sector
-- closed. p_hours = [{"weekday":1,"opens":"08:00","closes":"12:00"}, …].
-- Overlapping ranges are rejected by sector_hours_no_overlap (23P01) and the
-- whole call rolls back.
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

  insert into public.sector_hours (sector_id, weekday, opens, closes)
  select p_sector, h.weekday, h.opens, h.closes
  from jsonb_to_recordset(p_hours) as h(weekday int, opens time, closes time);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.set_sector_hours(uuid, jsonb) from public, anon;
grant execute on function public.set_sector_hours(uuid, jsonb) to authenticated;
