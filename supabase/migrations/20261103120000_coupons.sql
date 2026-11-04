-- Discount coupons: a code an admin creates with a fixed percent, entered by the
-- client when a turno or pack payment is generated (ADR 0016). Abono cuotas don't
-- take coupons.
--
-- payments.amount_ars stays what the client must transfer (the discounted price),
-- so the settle-time amount check needs no change. A "use" is derived, never
-- counted: an approved, unreversed payment carrying the coupon. Abandoned CVUs,
-- expiries and revived rejected rows therefore need no release logic.

create table public.coupons (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[A-Z0-9_-]{3,32}$'),
  percent    int  not null check (percent between 1 and 99),
  active     boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- Admin only, reads included: `active or is_admin()` would let any client list
-- the codes. create-payment validates a code with the service role. No delete
-- policy: payments reference coupons, and "off" is what the switch is for.
alter table public.coupons enable row level security;
create policy coupons_admin_select on public.coupons
  for select to authenticated using (public.is_admin());
create policy coupons_admin_insert on public.coupons
  for insert to authenticated with check (public.is_admin());
create policy coupons_admin_update on public.coupons
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.payments
  add column coupon_id uuid references public.coupons(id) on delete restrict,
  -- Snapshot of the percent, kept apart from the coupon: the client sees it through
  -- payments_select_own without being able to read the coupons table.
  add column coupon_pct int check (coupon_pct between 1 and 99),
  -- The full price before the discount.
  add column list_amount_ars int,
  -- Talo's hosted page, kept so a reload or the way back can return to it. Holds
  -- only the host and the payment id, never the webhook token (ADR 0016).
  add column talo_payment_url text,
  add constraint payments_coupon_shape check (
    (coupon_id is null) = (coupon_pct is null)
    and (coupon_id is null) = (list_amount_ars is null)
  );

create index payments_coupon_idx on public.payments (coupon_id)
  where coupon_id is not null;

-- ─── Admin reads ────────────────────────────────────────────────────────────
create function public.admin_coupons()
returns table (
  id             uuid,
  code           text,
  percent        int,
  active         boolean,
  created_at     timestamptz,
  uses           bigint,
  discounted_ars bigint
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select c.id, c.code, c.percent, c.active, c.created_at,
           count(p.id),
           coalesce(sum(p.list_amount_ars - p.amount_ars), 0)::bigint
    from public.coupons c
    left join public.payments p
      on p.coupon_id = c.id and p.status = 'approved' and p.reversed_at is null
    group by c.id
    order by c.active desc, c.created_at desc;
end;
$$;

-- Booking payments carry no user_id or service_id of their own: both come from
-- the booking.
create function public.admin_coupon_uses(p_coupon_id uuid)
returns table (
  payment_id      uuid,
  client_name     text,
  service_name    text,
  created_at      timestamptz,
  amount_ars      int,
  list_amount_ars int
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select p.id, pr.full_name, s.name, p.created_at, p.amount_ars, p.list_amount_ars
    from public.payments p
    left join public.bookings b on b.id = p.booking_id
    left join public.profiles pr on pr.id = coalesce(p.user_id, b.user_id)
    left join public.services s on s.id = coalesce(p.service_id, b.service_id)
    where p.coupon_id = p_coupon_id
      and p.status = 'approved'
      and p.reversed_at is null
    order by p.created_at desc
    limit 200;
end;
$$;

revoke execute on function public.admin_coupons() from public, anon;
revoke execute on function public.admin_coupon_uses(uuid) from public, anon;
grant execute on function public.admin_coupons() to authenticated;
grant execute on function public.admin_coupon_uses(uuid) to authenticated;

do $$
declare
  fn  text;
  fns text[] := array['public.admin_coupons()', 'public.admin_coupon_uses(uuid)'];
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
