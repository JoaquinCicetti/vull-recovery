-- ============================================================================
-- Backoffice: client list, metrics, and manual credit adjustment
-- ============================================================================
-- The admin panel could only list turnos. These three functions back the new
-- Clientes and Métricas tabs. All are SECURITY DEFINER (they aggregate across
-- every user) and gate on public.is_admin(), which reads the CALLER's committed
-- profile row via auth.uid() — so unlike the credit internals closed in
-- 20260824120000 they are safe to expose to `authenticated`: a non-admin gets an
-- empty set / null / a 42501, never data.
--
--   admin_user_list(...)     one row per client with turno counts + live balance
--   admin_metrics(p_days)    counters + a time series for the dashboard
--   admin_adjust_credit(...) the admin-facing wrapper adjust_credit never had
--                            (it was callable only by service role, and no edge
--                            function called it — there was no way to comp or
--                            correct a balance short of SQL)

-- ─── Clients ────────────────────────────────────────────────────────────────
-- bookings_total counts turnos that were actually held (confirmed or no-show);
-- cancelled/expired ones are noise for "how many turnos does this client have".
-- credits is the LIVE balance: an expired balance reads as 0, as everywhere else.
create or replace function public.admin_user_list(
  p_search       text    default null,
  p_only_balance boolean default false,
  p_sort         text    default 'recent',
  p_limit        int     default 25,
  p_offset       int     default 0
)
returns table (
  id                uuid,
  full_name         text,
  email             text,
  whatsapp_phone    text,
  is_admin          boolean,
  created_at        timestamptz,
  bookings_total    int,
  bookings_upcoming int,
  last_booking_at   timestamptz,
  credits           int,
  total_count       bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      p.id, p.full_name, p.email, p.whatsapp_phone, p.is_admin, p.created_at,
      coalesce(b.total, 0)::int    as bookings_total,
      coalesce(b.upcoming, 0)::int as bookings_upcoming,
      b.last_at                    as last_booking_at,
      coalesce(c.credits, 0)::int  as credits
    from public.profiles p
    left join lateral (
      select
        count(*) filter (where bk.status in ('confirmed', 'no_show')) as total,
        count(*) filter (
          where bk.status in ('pending', 'awaiting_payment', 'confirmed')
            and bk.starts_at > now()
        ) as upcoming,
        max(bk.starts_at) filter (
          where bk.status = 'confirmed' and bk.starts_at <= now()
        ) as last_at
      from public.bookings bk
      where bk.user_id = p.id
    ) b on true
    left join lateral (
      select sum(uc.remaining) as credits
      from public.user_credits uc
      where uc.user_id = p.id
        and uc.remaining > 0
        and (uc.expires_at is null or uc.expires_at > now())
    ) c on true
    where public.is_admin()
      and (
        coalesce(btrim(p_search), '') = ''
        or p.full_name      ilike '%' || btrim(p_search) || '%'
        or p.email          ilike '%' || btrim(p_search) || '%'
        or p.whatsapp_phone ilike '%' || btrim(p_search) || '%'
      )
  )
  select base.*, count(*) over () as total_count
  from base
  where not coalesce(p_only_balance, false) or base.credits > 0
  order by
    case when p_sort = 'credits'  then base.credits end desc nulls last,
    case when p_sort = 'bookings' then base.bookings_total end desc nulls last,
    case when p_sort = 'name'     then lower(coalesce(base.full_name, base.email, '')) end asc,
    base.created_at desc,
    base.id
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- ─── Metrics ────────────────────────────────────────────────────────────────
-- One round trip for the whole dashboard. The window is the last p_days days;
-- buckets are local (settings.timezone) days, or weeks once the window is long.
-- Turno counters only look at turnos whose time has ALREADY passed, so a future
-- confirmed turno never inflates "realizados". Revenue is what was recorded as an
-- approved, non-reversed payment — a turno confirmed by hand for cash has no
-- payment row and is not in it.
create or replace function public.admin_metrics(p_days int default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with win as (
    select
      coalesce(
        (select s.timezone from public.settings s where s.id),
        'America/Argentina/Buenos_Aires'
      ) as tz,
      greatest(1, least(coalesce(p_days, 30), 730)) as days
  ),
  w as (
    select
      tz,
      days,
      now() - make_interval(days => days) as since,
      case when days > 60 then 'week' else 'day' end as unit
    from win
  ),
  buckets as (
    select g.bucket
    from w,
    lateral generate_series(
      date_trunc(w.unit, w.since at time zone w.tz),
      date_trunc(w.unit, now() at time zone w.tz),
      case when w.unit = 'week' then interval '1 week' else interval '1 day' end
    ) as g(bucket)
  )
  select case when public.is_admin() then jsonb_build_object(
    'days', (select days from w),
    'unit', (select unit from w),
    'users', jsonb_build_object(
      'total', (select count(*) from public.profiles),
      'new',   (select count(*) from public.profiles p, w where p.created_at >= w.since),
      'with_balance', (
        select count(distinct uc.user_id) from public.user_credits uc
        where uc.remaining > 0 and (uc.expires_at is null or uc.expires_at > now())
      ),
      'credits_outstanding', (
        select coalesce(sum(uc.remaining), 0) from public.user_credits uc
        where uc.remaining > 0 and (uc.expires_at is null or uc.expires_at > now())
      )
    ),
    'bookings', (
      select jsonb_build_object(
        'attended',  count(*) filter (where b.status = 'confirmed'),
        'no_show',   count(*) filter (where b.status = 'no_show'),
        'cancelled', count(*) filter (where b.status = 'cancelled'),
        'expired',   count(*) filter (where b.status = 'expired')
      )
      from public.bookings b, w
      where b.starts_at >= w.since and b.starts_at <= now()
    ),
    'upcoming', (
      select count(*) from public.bookings b
      where b.status in ('pending', 'awaiting_payment', 'confirmed')
        and b.starts_at > now()
    ),
    'revenue', (
      select jsonb_build_object(
        'total',    coalesce(sum(p.amount_ars), 0),
        'count',    count(*),
        'bookings', coalesce(sum(p.amount_ars) filter (where p.kind = 'booking'), 0),
        'packs',    coalesce(sum(p.amount_ars) filter (where p.kind = 'pack'), 0)
      )
      from public.payments p, w
      where p.status = 'approved' and p.reversed_at is null
        and p.created_at >= w.since
    ),
    'services', (
      select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'count', x.n)
                                order by x.n desc, x.name), '[]'::jsonb)
      from (
        select s.name, count(*) as n
        from public.bookings b
        join public.services s on s.id = b.service_id, w
        where b.status in ('confirmed', 'no_show')
          and b.starts_at >= w.since and b.starts_at <= now()
        group by s.name
        order by n desc
        limit 8
      ) x
    ),
    'series', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'bucket', to_char(k.bucket, 'YYYY-MM-DD'),
        'bookings', (
          select count(*) from public.bookings b, w
          where b.status in ('confirmed', 'no_show')
            and b.starts_at >= w.since and b.starts_at <= now()
            and date_trunc(w.unit, b.starts_at at time zone w.tz) = k.bucket
        ),
        'users', (
          select count(*) from public.profiles p, w
          where p.created_at >= w.since
            and date_trunc(w.unit, p.created_at at time zone w.tz) = k.bucket
        ),
        'revenue', (
          select coalesce(sum(p.amount_ars), 0) from public.payments p, w
          where p.status = 'approved' and p.reversed_at is null
            and p.created_at >= w.since
            and date_trunc(w.unit, p.created_at at time zone w.tz) = k.bucket
        )
      ) order by k.bucket), '[]'::jsonb)
      from buckets k
    )
  ) end;
$$;

-- ─── Manual credit adjustment (comp / correct) ──────────────────────────────
-- Returns the delta actually applied (a downward adjustment is clamped so the
-- balance never goes below 0; 0 means nothing changed and nothing was logged).
--
-- Deliberately NOT a thin wrapper over adjust_credit(): that one adds to
-- user_credits.remaining and leaves expires_at alone, so a credit granted to a
-- client whose pack had EXPIRED landed on a dead row and the balance still read
-- 0. Here a lapsed row is reset first (its old credits were already worth 0), so
-- what the admin grants is what the client can spend. A live expiry is kept.
create or replace function public.admin_adjust_credit(
  p_user uuid, p_service uuid, p_delta int, p_note text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  cur  public.user_credits;
  live int := 0;
  d    int := coalesce(p_delta, 0);
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Cliente inexistente' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.services where id = p_service) then
    raise exception 'Servicio inexistente' using errcode = 'P0001';
  end if;

  select * into cur from public.user_credits
  where user_id = p_user and service_id = p_service
  for update;

  if found and (cur.expires_at is null or cur.expires_at > now()) then
    live := cur.remaining;
  end if;

  if d < 0 then d := greatest(d, -live); end if;
  if d = 0 then return 0; end if;

  insert into public.user_credits (user_id, service_id, remaining, expires_at)
  values (p_user, p_service, live + d, null)
  on conflict (user_id, service_id) do update set
    remaining  = live + d,
    expires_at = case
      when public.user_credits.expires_at is not null
       and public.user_credits.expires_at <= now() then null
      else public.user_credits.expires_at
    end,
    updated_at = now();

  insert into public.credit_ledger (user_id, service_id, delta, reason, note, created_by)
  values (p_user, p_service, d, 'admin_adjust', nullif(btrim(p_note), ''), auth.uid());

  return d;
end;
$$;

-- ─── Grants: signed-in callers only (the functions themselves check is_admin) ─
-- Revoke from PUBLIC too — a REVOKE aimed at anon alone leaves the default PUBLIC
-- grant in place (see 20260824120000_revoke_public_rpc.sql).
revoke execute on function public.admin_user_list(text, boolean, text, int, int)
  from public, anon;
revoke execute on function public.admin_metrics(int) from public, anon;
revoke execute on function public.admin_adjust_credit(uuid, uuid, int, text)
  from public, anon;
grant execute on function public.admin_user_list(text, boolean, text, int, int)
  to authenticated;
grant execute on function public.admin_metrics(int) to authenticated;
grant execute on function public.admin_adjust_credit(uuid, uuid, int, text)
  to authenticated;

do $$
declare
  fn  text;
  fns text[] := array[
    'public.admin_user_list(text, boolean, text, int, int)',
    'public.admin_metrics(int)',
    'public.admin_adjust_credit(uuid, uuid, int, text)'
  ];
begin
  foreach fn in array fns loop
    if has_function_privilege('anon', fn, 'execute') then
      raise exception '% is still EXECUTE-able by anon', fn;
    end if;
    if not has_function_privilege('authenticated', fn, 'execute') then
      raise exception '% must be callable by authenticated', fn;
    end if;
  end loop;
end $$;
