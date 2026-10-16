-- ============================================================================
-- Swapping classes between clients (propose → accept)
-- ============================================================================
-- A client may offer one of their classes to another client in exchange for
-- one of theirs. The other client accepts or declines in the app. Rules (also
-- in docs/booking-invariants.md):
--
--   * both classes are `confirmed`, in the same sector, of different clients;
--   * both start at least sectors.change_notice_hours from now (24 h default),
--     checked when proposing AND again when accepting;
--   * both fall in the same local week (Mon–Sun) and the same calendar month,
--     so a paid month's class never moves into an unpaid one.
--
-- A swap exchanges the TIME and BED of the two bookings rows; each row keeps
-- its owner, so the turno page, its payment, its calendar event and its emails
-- all stay attached to the right person.
--
-- bookings_one_per_day is a partial UNIQUE index: checked per row, never
-- deferrable. Moving B onto A's day while A is still there would trip it even
-- when the final state is legal (a same-day swap). So the swap parks A outside
-- the active predicates first, moves B, then moves A back in with its status.
-- Other transactions see A's old index entries until commit (they block on the
-- EXCLUDE recheck), and any failure rolls the whole thing back.

create table public.swap_requests (
  id              uuid primary key default gen_random_uuid(),
  from_booking_id uuid not null references public.bookings(id) on delete cascade,
  to_booking_id   uuid not null references public.bookings(id) on delete cascade,
  from_user_id    uuid not null references public.profiles(id) on delete cascade,
  to_user_id      uuid not null references public.profiles(id) on delete cascade,
  status          text not null default 'pending'
                  check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  constraint swap_requests_distinct check (
    from_booking_id <> to_booking_id and from_user_id <> to_user_id
  )
);
-- One open offer per class.
create unique index swap_requests_pending_from_uniq
  on public.swap_requests (from_booking_id) where status = 'pending';
create index swap_requests_to_idx on public.swap_requests (to_user_id) where status = 'pending';

alter table public.swap_requests enable row level security;
create policy swap_requests_read on public.swap_requests
  for select using (from_user_id = auth.uid() or to_user_id = auth.uid() or public.is_admin());

-- ─── the rules, in one place ────────────────────────────────────────────────
-- Raises P0001 with a token: not_found, not_confirmed, different_sector,
-- same_user, too_late, different_week.
create or replace function public.swap_precheck(p_a uuid, p_b uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.bookings;
  b public.bookings;
  s public.sectors;
begin
  select * into a from public.bookings where id = p_a;
  select * into b from public.bookings where id = p_b;
  if a.id is null or b.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if a.status <> 'confirmed' or b.status <> 'confirmed' then
    raise exception 'not_confirmed' using errcode = 'P0001';
  end if;
  if a.sector_id <> b.sector_id then
    raise exception 'different_sector' using errcode = 'P0001';
  end if;
  if a.user_id = b.user_id then
    raise exception 'same_user' using errcode = 'P0001';
  end if;
  select * into s from public.sectors where id = a.sector_id;
  if least(a.starts_at, b.starts_at) < now() + make_interval(hours => s.change_notice_hours) then
    raise exception 'too_late' using errcode = 'P0001';
  end if;
  if date_trunc('week', a.starts_at at time zone s.timezone)
       <> date_trunc('week', b.starts_at at time zone s.timezone)
     or date_trunc('month', a.starts_at at time zone s.timezone)
       <> date_trunc('month', b.starts_at at time zone s.timezone) then
    raise exception 'different_week' using errcode = 'P0001';
  end if;
end;
$$;

-- ─── the swap ───────────────────────────────────────────────────────────────
-- Same-day conflicts surface as 23505 with detail {"side":"a"|"b"}: side b =
-- B's owner already has a class on A's day, side a = A's owner on B's day.
create or replace function public.swap_bookings(p_a uuid, p_b uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.bookings;
  b public.bookings;
begin
  -- Fixed lock order: two opposite swaps can't deadlock.
  perform 1 from public.bookings where id = least(p_a, p_b) for update;
  perform 1 from public.bookings where id = greatest(p_a, p_b) for update;
  perform public.swap_precheck(p_a, p_b);
  select * into a from public.bookings where id = p_a;
  select * into b from public.bookings where id = p_b;

  update public.bookings set status = 'expired' where id = a.id;
  begin
    update public.bookings
       set starts_at = a.starts_at, ends_at = a.ends_at, resource_id = a.resource_id
     where id = b.id;
  exception when unique_violation then
    raise exception 'same_day' using errcode = '23505', detail = '{"side":"b"}';
  end;
  begin
    update public.bookings
       set starts_at = b.starts_at, ends_at = b.ends_at, resource_id = b.resource_id,
           status = a.status
     where id = a.id;
  exception when unique_violation then
    raise exception 'same_day' using errcode = '23505', detail = '{"side":"a"}';
  end;
end;
$$;

create or replace function public.propose_swap(p_from uuid, p_to uuid, p_user uuid)
returns public.swap_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.bookings;
  b public.bookings;
  r public.swap_requests;
begin
  select * into a from public.bookings where id = p_from;
  if not found or a.user_id <> p_user then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;
  perform public.swap_precheck(p_from, p_to);
  select * into b from public.bookings where id = p_to;
  begin
    insert into public.swap_requests (from_booking_id, to_booking_id, from_user_id, to_user_id)
    values (a.id, b.id, a.user_id, b.user_id)
    returning * into r;
  exception when unique_violation then
    raise exception 'pending_exists' using errcode = 'P0001';
  end;
  return r;
end;
$$;

-- p_action: accept | decline (the receiver) or cancel (the proposer).
create or replace function public.resolve_swap(p_request uuid, p_user uuid, p_action text)
returns public.swap_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.swap_requests;
begin
  select * into r from public.swap_requests where id = p_request for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if r.status <> 'pending' then
    raise exception 'request_closed' using errcode = 'P0001';
  end if;

  if p_action = 'cancel' then
    if r.from_user_id <> p_user then raise exception 'not_owner' using errcode = 'P0001'; end if;
    update public.swap_requests set status = 'cancelled', resolved_at = now()
     where id = r.id returning * into r;
  elsif p_action = 'decline' then
    if r.to_user_id <> p_user then raise exception 'not_owner' using errcode = 'P0001'; end if;
    update public.swap_requests set status = 'declined', resolved_at = now()
     where id = r.id returning * into r;
  elsif p_action = 'accept' then
    if r.to_user_id <> p_user then raise exception 'not_owner' using errcode = 'P0001'; end if;
    perform public.swap_bookings(r.from_booking_id, r.to_booking_id);
    update public.swap_requests set status = 'accepted', resolved_at = now()
     where id = r.id returning * into r;
    -- Both classes just moved: any other open offer on them is stale.
    update public.swap_requests set status = 'expired', resolved_at = now()
     where status = 'pending' and id <> r.id
       and (from_booking_id in (r.from_booking_id, r.to_booking_id)
            or to_booking_id in (r.from_booking_id, r.to_booking_id));
  else
    raise exception 'bad_action' using errcode = 'P0001';
  end if;
  return r;
end;
$$;

-- Lazy: an offer dies once either class is no longer confirmed or is inside
-- the change notice.
create or replace function public.expire_swap_requests()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.swap_requests r set status = 'expired', resolved_at = now()
   where r.status = 'pending'
     and exists (
       select 1 from public.bookings b join public.sectors s on s.id = b.sector_id
       where b.id in (r.from_booking_id, r.to_booking_id)
         and (b.status <> 'confirmed'
              or b.starts_at < now() + make_interval(hours => s.change_notice_hours))
     );
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ─── what the browser may read ──────────────────────────────────────────────
-- A client cannot read other clients' bookings or profiles (RLS), so these two
-- are auth.uid()-scoped definer functions that show only what a swap needs:
-- time, bed, and first name + initial.
create or replace function public.client_label(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(trim(
      split_part(trim(coalesce(p.full_name, '')), ' ', 1) || ' ' ||
      left(nullif(split_part(trim(coalesce(p.full_name, '')), ' ', 2), ''), 1) ||
      case when split_part(trim(coalesce(p.full_name, '')), ' ', 2) <> '' then '.' else '' end
    ), ''),
    'Otro cliente')
  from public.profiles p where p.id = p_user;
$$;

-- Classes the caller's class could be swapped with: other clients' confirmed
-- classes in the same sector, week and month, outside the notice, on days that
-- break nobody's one-class-a-day rule.
create or replace function public.swap_candidates(p_booking uuid)
returns table (
  booking_id    uuid,
  starts_at     timestamptz,
  ends_at       timestamptz,
  resource_name text,
  client_label  text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.bookings;
  s public.sectors;
begin
  select * into a from public.bookings where id = p_booking;
  if not found or a.user_id is distinct from auth.uid() then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;
  select * into s from public.sectors where id = a.sector_id;
  if a.status <> 'confirmed'
     or a.starts_at < now() + make_interval(hours => s.change_notice_hours) then
    return;
  end if;

  return query
  select b.id, b.starts_at, b.ends_at, r.name, public.client_label(b.user_id)
  from public.bookings b
  join public.resources r on r.id = b.resource_id
  where b.sector_id = a.sector_id
    and b.status = 'confirmed'
    and b.user_id <> a.user_id
    and b.starts_at >= now() + make_interval(hours => s.change_notice_hours)
    and date_trunc('week', b.starts_at at time zone s.timezone)
        = date_trunc('week', a.starts_at at time zone s.timezone)
    and date_trunc('month', b.starts_at at time zone s.timezone)
        = date_trunc('month', a.starts_at at time zone s.timezone)
    -- the caller has nothing else on B's day…
    and not exists (
      select 1 from public.bookings x
      where x.user_id = a.user_id and x.sector_id = a.sector_id and x.id <> a.id
        and x.status in ('pending', 'awaiting_payment', 'confirmed')
        and public.booking_local_date(x.starts_at) = public.booking_local_date(b.starts_at))
    -- …and B's owner has nothing else on A's day.
    and not exists (
      select 1 from public.bookings x
      where x.user_id = b.user_id and x.sector_id = a.sector_id and x.id <> b.id
        and x.status in ('pending', 'awaiting_payment', 'confirmed')
        and public.booking_local_date(x.starts_at) = public.booking_local_date(a.starts_at))
  order by b.starts_at, r.sort_order;
end;
$$;

-- The caller's offers, both directions, with what each side would get.
create or replace function public.my_swap_requests()
returns table (
  id                uuid,
  direction         text,
  status            text,
  from_booking_id   uuid,
  to_booking_id     uuid,
  from_starts_at    timestamptz,
  from_resource     text,
  to_starts_at      timestamptz,
  to_resource       text,
  counterpart_label text,
  created_at        timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
         case when r.from_user_id = auth.uid() then 'out' else 'in' end,
         r.status, r.from_booking_id, r.to_booking_id,
         fb.starts_at, fr.name, tb.starts_at, tr.name,
         public.client_label(case when r.from_user_id = auth.uid()
                                  then r.to_user_id else r.from_user_id end),
         r.created_at
  from public.swap_requests r
  join public.bookings fb on fb.id = r.from_booking_id
  join public.resources fr on fr.id = fb.resource_id
  join public.bookings tb on tb.id = r.to_booking_id
  join public.resources tr on tr.id = tb.resource_id
  where (r.from_user_id = auth.uid() or r.to_user_id = auth.uid())
    and (r.status = 'pending' or r.resolved_at > now() - interval '7 days')
  order by r.created_at desc
  limit 30;
$$;

-- ─── housekeeping now also expires stale offers ─────────────────────────────
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
  v_swaps int;
begin
  v_mem := public.expire_memberships();
  update public.bookings set status = 'expired'
   where status = 'pending' and hold_expires_at < now();
  get diagnostics v_holds = row_count;
  v_roll := public.roll_memberships(null);
  v_swaps := public.expire_swap_requests();
  return jsonb_build_object('holds', v_holds, 'memberships', v_mem, 'rolled', v_roll,
                            'swaps', v_swaps);
end;
$$;

-- ─── privileges ─────────────────────────────────────────────────────────────
revoke execute on function public.swap_precheck(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.swap_bookings(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.propose_swap(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.resolve_swap(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.expire_swap_requests() from public, anon, authenticated;
revoke execute on function public.client_label(uuid) from public, anon, authenticated;
revoke execute on function public.housekeeping() from public, anon, authenticated;
revoke execute on function public.swap_candidates(uuid) from public, anon;
revoke execute on function public.my_swap_requests() from public, anon;
grant  execute on function public.swap_candidates(uuid) to authenticated;
grant  execute on function public.my_swap_requests() to authenticated;

do $$
declare
  fn   text;
  role text;
begin
  foreach fn in array array[
    'public.swap_precheck(uuid, uuid)', 'public.swap_bookings(uuid, uuid)',
    'public.propose_swap(uuid, uuid, uuid)', 'public.resolve_swap(uuid, uuid, text)',
    'public.expire_swap_requests()', 'public.client_label(uuid)', 'public.housekeeping()'
  ] loop
    foreach role in array array['anon', 'authenticated'] loop
      if has_function_privilege(role, fn, 'execute') then
        raise exception 'privilege leak: % can execute %', role, fn;
      end if;
    end loop;
  end loop;
end;
$$;
