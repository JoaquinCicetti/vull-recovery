-- ============================================================================
-- Multi-session packs → per-user, per-service appointment-credit balance
-- ============================================================================
-- A "pack" is a services row with grants_service_id set: buying it once grants
-- `sessions_included` credits, redeemable against that bookable service, valid
-- for `validity_days` (NULL = forever). A credit-funded booking is created
-- directly as 'confirmed' with no hold/payment; cancelling refunds one credit.
--
-- Two tables:
--   user_credits  — the operational balance (one row per user+service). The
--                   decrement is an atomic conditional UPDATE (remaining > 0),
--                   which is race-safe by the row lock, so two concurrent
--                   bookings can never double-spend.
--   credit_ledger — append-only audit of every grant/consume/refund/adjust, and
--                   the idempotency guard (unique per payment / per booking).
-- Doing the decrement + booking insert in ONE transaction (book_with_credit)
-- means a rejected slot (EXCLUDE / one-per-day) rolls back the decrement — no
-- credit leaks. One expiry per (user, service): topping up keeps the latest
-- (most generous) expiry; see docs.

-- ─── services: pack fields ───────────────────────────────────────────────────
alter table public.services
  add column if not exists sessions_included int not null default 1,
  add column if not exists grants_service_id uuid references public.services(id),
  add column if not exists validity_days int;
alter table public.services
  add constraint services_sessions_positive check (sessions_included >= 1),
  add constraint services_validity_positive check (validity_days is null or validity_days > 0);

-- ─── payments: support pack purchases (no booking) ───────────────────────────
alter table public.payments
  alter column booking_id drop not null,
  add column if not exists kind text not null default 'booking',
  add column if not exists service_id uuid references public.services(id),
  add column if not exists user_id uuid references public.profiles(id);
alter table public.payments
  add constraint payments_kind_check check (kind in ('booking', 'pack')),
  add constraint payments_shape_check check (
    (kind = 'booking' and booking_id is not null)
    or (kind = 'pack' and service_id is not null and user_id is not null)
  );

-- ─── operational balance ─────────────────────────────────────────────────────
create table public.user_credits (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  service_id uuid not null references public.services(id),
  remaining  int  not null default 0 check (remaining >= 0),
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, service_id)
);
alter table public.user_credits enable row level security;
-- Read own (or admin); all writes are via the SECURITY DEFINER functions below.
create policy user_credits_select_own on public.user_credits
  for select using (user_id = auth.uid() or public.is_admin());

-- ─── append-only audit trail ─────────────────────────────────────────────────
create table public.credit_ledger (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  service_id uuid not null references public.services(id),
  delta      int  not null,
  reason     text not null check (reason in
               ('purchase','booking_consume','booking_refund','admin_adjust','revoke')),
  booking_id uuid references public.bookings(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  note       text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index credit_ledger_user_idx on public.credit_ledger (user_id, service_id);
-- Idempotency: one purchase-grant per payment, one refund per booking.
create unique index credit_ledger_purchase_uniq on public.credit_ledger (payment_id) where reason = 'purchase';
create unique index credit_ledger_refund_uniq   on public.credit_ledger (booking_id) where reason = 'booking_refund';

alter table public.credit_ledger enable row level security;
create policy credit_ledger_select_own on public.credit_ledger
  for select using (user_id = auth.uid() or public.is_admin());

-- ─── balance (live remaining; expired balance reads as 0) ────────────────────
create or replace function public.credit_balance(p_user uuid, p_service uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case when expires_at is not null and expires_at <= now() then 0 else remaining end
    from public.user_credits where user_id = p_user and service_id = p_service
  ), 0);
$$;

-- Consume one credit and create the (already-confirmed) booking in one tx.
create or replace function public.book_with_credit(
  p_user uuid, p_service uuid, p_starts_at timestamptz, p_ends_at timestamptz
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_rows    int;
begin
  -- Atomic, race-safe decrement (the row lock serializes concurrent bookings).
  update public.user_credits
     set remaining = remaining - 1, updated_at = now()
   where user_id = p_user and service_id = p_service
     and remaining > 0 and (expires_at is null or expires_at > now());
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'no_credit' using errcode = 'P0001';
  end if;

  -- May raise 23P01 (overlap) / 23505 (one-per-day) → whole tx rolls back, so the
  -- decrement above is undone and no credit is lost.
  insert into public.bookings (user_id, service_id, starts_at, ends_at, status)
  values (p_user, p_service, p_starts_at, p_ends_at, 'confirmed')
  returning * into v_booking;

  insert into public.credit_ledger (user_id, service_id, delta, reason, booking_id)
  values (p_user, p_service, -1, 'booking_consume', v_booking.id);

  return v_booking;
end;
$$;

-- Grant a pack's credits when its payment is approved. Idempotent per payment.
create or replace function public.grant_pack_credits(p_payment_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  pay     public.payments;
  svc     public.services;
  new_exp timestamptz;
begin
  select * into pay from public.payments where id = p_payment_id;
  if pay is null or pay.kind <> 'pack' or pay.status <> 'approved' then
    return 0;
  end if;
  select * into svc from public.services where id = pay.service_id;
  if svc is null or svc.grants_service_id is null then
    return 0;
  end if;

  -- Idempotency guard: the audit row is unique per payment. If it already exists
  -- this is a retry — don't touch the counter again.
  insert into public.credit_ledger (user_id, service_id, delta, reason, payment_id)
  values (pay.user_id, svc.grants_service_id, svc.sessions_included, 'purchase', p_payment_id)
  on conflict (payment_id) where reason = 'purchase' do nothing;
  if not found then return 0; end if;

  if svc.validity_days is not null then
    new_exp := now() + make_interval(days => svc.validity_days);
  end if;

  insert into public.user_credits (user_id, service_id, remaining, expires_at)
  values (pay.user_id, svc.grants_service_id, svc.sessions_included, new_exp)
  on conflict (user_id, service_id) do update set
    remaining  = public.user_credits.remaining + excluded.remaining,
    -- Keep the most generous expiry; any no-expiry grant makes the balance never expire.
    expires_at = case
      when public.user_credits.expires_at is null or excluded.expires_at is null then null
      else greatest(public.user_credits.expires_at, excluded.expires_at)
    end,
    updated_at = now();

  return svc.sessions_included;
end;
$$;

-- Refund one credit when a credit-funded booking is cancelled. Once-only; a no-op
-- for bookings that never consumed a credit (normal paid/pending bookings).
create or replace function public.refund_booking_credit(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.credit_ledger;
begin
  select * into c from public.credit_ledger
  where booking_id = p_booking_id and reason = 'booking_consume'
  limit 1;
  if c is null then return false; end if;

  insert into public.credit_ledger (user_id, service_id, delta, reason, booking_id)
  values (c.user_id, c.service_id, 1, 'booking_refund', p_booking_id)
  on conflict (booking_id) where reason = 'booking_refund' do nothing;
  if not found then return false; end if;  -- already refunded

  insert into public.user_credits (user_id, service_id, remaining)
  values (c.user_id, c.service_id, 1)
  on conflict (user_id, service_id) do update set
    remaining = public.user_credits.remaining + 1, updated_at = now();

  return true;
end;
$$;

-- Admin manual adjustment (comp / correct). Downward is clamped to >= 0.
create or replace function public.adjust_credit(
  p_user uuid, p_service uuid, p_delta int, p_note text, p_admin uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  d int := p_delta;
begin
  if d < 0 then
    d := greatest(d, -public.credit_balance(p_user, p_service));
  end if;
  if d = 0 then return 0; end if;

  insert into public.user_credits (user_id, service_id, remaining)
  values (p_user, p_service, greatest(0, d))
  on conflict (user_id, service_id) do update set
    remaining = greatest(0, public.user_credits.remaining + d), updated_at = now();

  insert into public.credit_ledger (user_id, service_id, delta, reason, note, created_by)
  values (p_user, p_service, d, 'admin_adjust', p_note, p_admin);
  return d;
end;
$$;

-- The caller's own live balances (booking flow / "Mis créditos"). auth.uid()-scoped.
create or replace function public.my_credit_balances()
returns table (service_id uuid, balance int)
language sql
stable
security definer
set search_path = public
as $$
  select service_id, remaining
  from public.user_credits
  where user_id = auth.uid()
    and remaining > 0
    and (expires_at is null or expires_at > now());
$$;

-- Lock down direct RPC access: mutations + raw any-user balance are service-role
-- / SECURITY DEFINER internals; the browser only gets its own balances.
revoke execute on function public.credit_balance(uuid, uuid) from anon, authenticated;
revoke execute on function public.book_with_credit(uuid, uuid, timestamptz, timestamptz) from anon, authenticated;
revoke execute on function public.grant_pack_credits(uuid) from anon, authenticated;
revoke execute on function public.refund_booking_credit(uuid) from anon, authenticated;
revoke execute on function public.adjust_credit(uuid, uuid, int, text, uuid) from anon, authenticated;
grant execute on function public.my_credit_balances() to authenticated;
