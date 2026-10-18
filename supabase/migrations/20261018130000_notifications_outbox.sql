-- ============================================================================
-- Notification outbox (ADR 0013)
-- ============================================================================
-- Every notice used to be sent fire-and-forget from the edge function that
-- caused it: a failed email was swallowed, an isolate torn down after the
-- response lost it, and four copies of "confirm a booking" each decided on
-- their own who to tell. Now:
--
--   * the transition that causes a notice writes it HERE, in the same
--     transaction (emit_notification), so a committed change always has its
--     notice and a rolled-back one never does;
--   * one dispatcher (supabase/functions/_shared/notify.ts) claims rows, renders
--     and sends them, and records what went out (channels) or why not (error);
--   * a replay (webhook storm, reconcile run, double click) emits nothing new:
--     one row per (kind, subject, audience, dedup_key).
--
-- Also here: the booking transitions that were copied across edge functions
-- (confirm, cancel, reschedule) become one RPC each, and the RPCs of packs,
-- abonos and swaps emit their own notices. Who is told is decided by `actor`:
-- an admin's own action never notifies the other admins, only the client.

-- ─── the outbox ─────────────────────────────────────────────────────────────
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in (
                'booking_received', 'booking_confirmed', 'booking_cancelled',
                'booking_rescheduled', 'payment_to_verify', 'payment_rejected',
                'pack_purchased', 'membership_paid', 'membership_created_by_admin',
                'membership_cancelled', 'class_moved', 'swap_proposed', 'swap_resolved',
                'admin_alert')),
  -- The row the notice is about (booking, payment, cuota, membership, swap
  -- request); the renderer loads it at send time.
  subject_id  uuid,
  audience    text not null check (audience in ('admins', 'user')),
  -- The client concerned. Required for a user notice; on an admin notice it
  -- only names who did it.
  user_id     uuid references auth.users(id) on delete cascade,
  actor       text not null check (actor in ('client', 'admin', 'system')),
  payload     jsonb not null default '{}',
  dedup_key   text not null default '',
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  sent_at     timestamptz,
  attempts    int not null default 0,
  error       text,
  -- What was actually sent or attempted: {emails, pushes, errors?, fallback?}.
  channels    jsonb,
  constraint notifications_user_has_recipient check (audience = 'admins' or user_id is not null),
  -- NULLS NOT DISTINCT: an admin_alert with no subject still dedups on its key.
  constraint notifications_dedup unique nulls not distinct (kind, subject_id, audience, dedup_key)
);
create index notifications_unsent_idx on public.notifications (created_at) where sent_at is null;

alter table public.notifications enable row level security;
-- Admins read the queue (/admin "Avisos no enviados"); every write is the
-- service role's (emit, claim, the dispatcher's result) or retry_notification.
create policy notifications_admin_read on public.notifications
  for select using (public.is_admin());

-- Queue a notice. Idempotent: a second emit of the same (kind, subject,
-- audience, dedup_key) is a no-op.
create or replace function public.emit_notification(
  p_kind     text,
  p_subject  uuid,
  p_audience text,
  p_actor    text,
  p_user     uuid default null,
  p_payload  jsonb default '{}',
  p_dedup    text default ''
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (kind, subject_id, audience, actor, user_id, payload, dedup_key)
  values (p_kind, p_subject, p_audience, p_actor, p_user,
          coalesce(p_payload, '{}'::jsonb), coalesce(p_dedup, ''))
  on conflict on constraint notifications_dedup do nothing;
$$;

-- The dispatcher takes up to p_limit unsent rows. A claim is a 2-minute lease:
-- a dispatcher that dies mid-send leaves the row to be retried, and two
-- dispatchers never take the same row (skip locked). Five attempts, then the
-- row waits for an admin's retry.
create or replace function public.claim_notifications(p_limit int default 20)
returns setof public.notifications
language sql
security definer
set search_path = public
as $$
  update public.notifications n
     set claimed_at = now(), attempts = n.attempts + 1
   where n.id in (
     select id from public.notifications
      where sent_at is null
        and attempts < 5
        and (claimed_at is null or claimed_at < now() - interval '2 minutes')
      order by created_at
      limit greatest(p_limit, 1)
      for update skip locked
   )
  returning n.*;
$$;

-- /admin "Reintentar": put a failed row back in the queue with fresh attempts.
-- The next dispatch (a kick, the admin's "Reintentar ahora", the cron) sends it.
create or replace function public.retry_notification(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.notifications
     set attempts = 0, error = null, claimed_at = null
   where id = p_id and sent_at is null;
  return found;
end;
$$;

-- ─── channel preferences: at least one ──────────────────────────────────────
-- notify_push defaulted to true although nothing is delivered until a device
-- subscribes, so "push on" meant nothing for most clients. Push now starts off
-- and the browser turns it on only after a device actually subscribed
-- (components/account/notification-center.tsx). Clearing it for clients with
-- no device changes no delivery: they had none.
alter table public.profiles alter column notify_push set default false;
update public.profiles p
   set notify_push = false
 where p.notify_push
   and not exists (select 1 from public.push_subscriptions s where s.user_id = p.id);
-- Then nobody may be left with no channel at all.
update public.profiles set notify_email = true where not notify_email and not notify_push;
alter table public.profiles
  add constraint profiles_one_channel check (notify_email or notify_push);

-- ─── booking transitions (one each, replacing the copies at the edge) ───────

-- Confirm a pending / awaiting_payment turno, optionally approving the payment
-- that funded it. 'ok' | 'already' (was confirmed) | 'gone' (missing, expired,
-- cancelled). 23P01 propagates. The ONE place a paid turno tells the admins:
-- a payment itself never does, so paying a turno at booking is one notice.
create or replace function public.confirm_booking(
  p_booking uuid,
  p_payment uuid,
  p_actor   text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then return 'gone'; end if;
  if b.status = 'confirmed' then return 'already'; end if;
  if b.status not in ('pending', 'awaiting_payment') then return 'gone'; end if;

  update public.bookings set status = 'confirmed', hold_expires_at = null where id = b.id;
  if p_payment is not null then
    update public.payments set status = 'approved', admin_flag = null
     where id = p_payment and status <> 'approved';
  end if;

  perform public.emit_notification('booking_confirmed', b.id, 'user', p_actor, b.user_id,
                                   jsonb_build_object('funded', 'payment'));
  if p_actor <> 'admin' then
    perform public.emit_notification('booking_confirmed', b.id, 'admins', p_actor, b.user_id,
                                     jsonb_build_object('funded', 'payment'));
  end if;
  return 'ok';
end;
$$;

-- Cancel an active turno: reject its pending payments, return a credit where
-- the rule says so (return_cancelled_booking), tell the client, and the admins
-- when the client did it. Returns the credit outcome ('credited' | 'late' |
-- 'unpaid' | 'already' | 'membership') or 'gone'. The edge keeps what talks to
-- the outside world around it (Talo CVU kill, Google event).
create or replace function public.cancel_booking(
  p_booking  uuid,
  p_by       uuid,
  p_reason   text,
  p_by_admin boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  b        public.bookings;
  v_credit text;
  v_actor  text := case when p_by_admin then 'admin' else 'client' end;
begin
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by,
         cancellation_reason = p_reason, hold_expires_at = null
   where id = p_booking and status in ('pending', 'awaiting_payment', 'confirmed')
  returning * into b;
  if not found then return 'gone'; end if;

  update public.payments set status = 'rejected'
   where booking_id = b.id and status = 'pending';

  -- An abono class frees its bed and returns nothing (ADR 0011).
  if b.membership_id is not null then
    v_credit := 'membership';
  else
    v_credit := public.return_cancelled_booking(b.id, p_by_admin);
  end if;

  perform public.emit_notification('booking_cancelled', b.id, 'user', v_actor, b.user_id,
                                   jsonb_build_object('credit', v_credit, 'by_admin', p_by_admin));
  if not p_by_admin then
    perform public.emit_notification('booking_cancelled', b.id, 'admins', v_actor, b.user_id,
                                     jsonb_build_object('credit', v_credit));
  end if;
  return v_credit;
end;
$$;

-- Move an active turno to a new time (and bed: null lets set_booking_sector
-- pick a free one). The edge validated the slot; the EXCLUDE and the per-day
-- index arbitrate (23P01 / 23505 propagate). {result: 'ok'|'gone',
-- previous_starts_at}.
create or replace function public.reschedule_booking(
  p_booking  uuid,
  p_starts   timestamptz,
  p_ends     timestamptz,
  p_resource uuid,
  p_actor    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.status not in ('pending', 'awaiting_payment', 'confirmed') then
    return jsonb_build_object('result', 'gone');
  end if;

  update public.bookings
     set starts_at = p_starts, ends_at = p_ends, resource_id = p_resource
   where id = b.id;

  -- A bed change at the same time is not news to the client.
  if p_starts <> b.starts_at then
    -- Each move is its own notice (A→B→A must tell the client twice).
    perform public.emit_notification('booking_rescheduled', b.id, 'user', p_actor, b.user_id,
              jsonb_build_object('previous_starts_at', b.starts_at, 'starts_at', p_starts),
              p_starts::text || '@' || now()::text);
    if p_actor <> 'admin' then
      perform public.emit_notification('booking_rescheduled', b.id, 'admins', p_actor, b.user_id,
                jsonb_build_object('previous_starts_at', b.starts_at, 'starts_at', p_starts),
                p_starts::text || '@' || now()::text);
    end if;
  end if;
  return jsonb_build_object('result', 'ok', 'previous_starts_at', b.starts_at);
end;
$$;

-- ─── packs ──────────────────────────────────────────────────────────────────
-- From 20260701120000; the decrement now also returns what is left, for the
-- two notices. Credit bookings tell the admins "X usó 1 sesión de su pack
-- (quedan N)".
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
  v_left    int;
begin
  -- Atomic, race-safe decrement (the row lock serializes concurrent bookings).
  update public.user_credits
     set remaining = remaining - 1, updated_at = now()
   where user_id = p_user and service_id = p_service
     and remaining > 0 and (expires_at is null or expires_at > now())
  returning remaining into v_left;
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

  perform public.emit_notification('booking_confirmed', v_booking.id, 'user', 'client', p_user,
            jsonb_build_object('funded', 'credit', 'remaining', v_left));
  perform public.emit_notification('booking_confirmed', v_booking.id, 'admins', 'client', p_user,
            jsonb_build_object('funded', 'credit', 'remaining', v_left));

  return v_booking;
end;
$$;

-- Verbatim from 20260702130000 + p_actor and the notices. An admin approving a
-- receipt already knows; Talo settling one ('system') tells the admins.
drop function public.grant_pack_credits(uuid);
create function public.grant_pack_credits(p_payment_id uuid, p_actor text default 'system')
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
  if svc is null or svc.sessions_included <= 1 then
    return 0;
  end if;

  insert into public.credit_ledger (user_id, service_id, delta, reason, payment_id)
  values (pay.user_id, svc.id, svc.sessions_included, 'purchase', p_payment_id)
  on conflict (payment_id) where reason = 'purchase' do nothing;
  if not found then return 0; end if;

  if svc.validity_days is not null then
    new_exp := now() + make_interval(days => svc.validity_days);
  end if;

  insert into public.user_credits (user_id, service_id, remaining, expires_at)
  values (pay.user_id, svc.id, svc.sessions_included, new_exp)
  on conflict (user_id, service_id) do update set
    remaining  = public.user_credits.remaining + excluded.remaining,
    expires_at = case
      when public.user_credits.expires_at is null or excluded.expires_at is null then null
      else greatest(public.user_credits.expires_at, excluded.expires_at)
    end,
    updated_at = now();

  perform public.emit_notification('pack_purchased', p_payment_id, 'user', p_actor, pay.user_id);
  if p_actor <> 'admin' then
    perform public.emit_notification('pack_purchased', p_payment_id, 'admins', p_actor, pay.user_id);
  end if;

  return svc.sessions_included;
end;
$$;

-- ─── abonos ─────────────────────────────────────────────────────────────────
-- A recurring member whose bed was taken next month: one admin alert per
-- member and month (housekeeping runs this many times a day).
create or replace function public.emit_roll_alert(p_membership uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_plan text;
  v_next date;
  v_user uuid;
begin
  select m.user_id, coalesce(nullif(p.full_name, ''), 'Un cliente'), coalesce(s.name, 'abono'),
         public.membership_next_period(m.sector_id)
    into v_user, v_name, v_plan, v_next
    from public.memberships m
    left join public.profiles p on p.id = m.user_id
    left join public.services s on s.id = m.service_id
   where m.id = p_membership;
  if v_user is null then return; end if;
  perform public.emit_notification('admin_alert', p_membership, 'admins', 'system', v_user,
    jsonb_build_object(
      'heading', 'Abono sin lugar el mes que viene',
      'body', format('A %s (%s) le tomaron una cama del mes próximo y su abono no se pudo renovar. Reprogramá el turno que la ocupa o cambiale la cama desde Abonos.',
                     v_name, v_plan)),
    p_membership::text || ':' || v_next::text);
end;
$$;

-- Verbatim from 20261015150000 + p_actor and the notices. Who paid matters for
-- the admins only: a cuota paid at the desk ('admin') or a receipt an admin
-- approved is not news to them; Talo settling one is.
drop function public.approve_membership_period(uuid, uuid);
create function public.approve_membership_period(
  p_period  uuid,
  p_payment uuid,
  p_actor   text default 'system'
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
  v_first boolean;
begin
  select * into per from public.membership_periods where id = p_period for update;
  if not found then return 'not_found'; end if;
  if per.status = 'paid' then return 'already'; end if;
  select * into m from public.memberships where id = per.membership_id for update;
  if per.status = 'void' or m.status not in ('pending', 'active') then return 'no_slot'; end if;
  -- The first cuota is the signup: the admins hear "new abono", not "cuota".
  v_first := m.status = 'pending';

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
      perform public.emit_roll_alert(m.id);
    end;
  end if;

  perform public.emit_notification('membership_paid', per.id, 'user', p_actor, m.user_id,
                                   jsonb_build_object('first', v_first));
  if p_actor <> 'admin' then
    perform public.emit_notification('membership_paid', per.id, 'admins', p_actor, m.user_id,
                                     jsonb_build_object('first', v_first));
  end if;
  return 'ok';
end;
$$;

-- Verbatim from 20261015150000; cash is always an admin's action.
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

  return public.approve_membership_period(p_period, v_pay, 'admin');
end;
$$;

-- Verbatim from 20261015150000 + the client's notice. Only an admin releases.
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

  perform public.emit_notification('membership_cancelled', m.id, 'user', 'admin', m.user_id,
                                   jsonb_build_object('by_admin', true));
  return n;
end;
$$;

-- Verbatim from 20261015150000 + p_actor: a CLIENT who stops renewing frees a
-- bed next month, which the admins want to know.
drop function public.set_membership_locked(uuid, boolean);
create function public.set_membership_locked(
  p_membership uuid,
  p_locked     boolean,
  p_actor      text default 'system'
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
    if p_actor = 'client' and m.locked then
      perform public.emit_notification('membership_cancelled', m.id, 'admins', 'client', m.user_id,
                jsonb_build_object('ends_on', v_keep), 'unlock@' || now()::text);
    end if;
  end if;
  return (select to_jsonb(x) from public.memberships x where x.id = m.id);
end;
$$;

-- Verbatim from 20261015150000 + the alert on a collision.
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
      perform public.emit_roll_alert(r.id);
    end;
  end loop;
  return n;
end;
$$;

-- ─── swaps ──────────────────────────────────────────────────────────────────
-- Verbatim from 20261015160000 + the receiver's notice.
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
  perform public.emit_notification('swap_proposed', r.id, 'user', 'client', r.to_user_id);
  return r;
end;
$$;

-- Verbatim from 20261015160000 + the proposer's notice, and "Clase movida" to
-- the admins on an accepted swap.
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
    perform public.emit_notification('swap_resolved', r.id, 'user', 'client', r.from_user_id,
                                     jsonb_build_object('outcome', 'declined'));
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
    perform public.emit_notification('swap_resolved', r.id, 'user', 'client', r.from_user_id,
                                     jsonb_build_object('outcome', 'accepted'));
    perform public.emit_notification('class_moved', r.id, 'admins', 'client', r.from_user_id,
                                     jsonb_build_object('swap', true));
  else
    raise exception 'bad_action' using errcode = 'P0001';
  end if;
  return r;
end;
$$;

-- ─── privileges ─────────────────────────────────────────────────────────────
-- Service role only, except retry_notification (admin-gated inside). See
-- 20260824120000_revoke_public_rpc.sql for why PUBLIC must be revoked.
revoke execute on function public.emit_notification(text, uuid, text, text, uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.claim_notifications(int) from public, anon, authenticated;
revoke execute on function public.retry_notification(uuid) from public, anon;
grant  execute on function public.retry_notification(uuid) to authenticated;
revoke execute on function public.confirm_booking(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.cancel_booking(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.reschedule_booking(uuid, timestamptz, timestamptz, uuid, text) from public, anon, authenticated;
revoke execute on function public.book_with_credit(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.grant_pack_credits(uuid, text) from public, anon, authenticated;
revoke execute on function public.emit_roll_alert(uuid) from public, anon, authenticated;
revoke execute on function public.approve_membership_period(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.pay_period_cash(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.release_membership(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.set_membership_locked(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.roll_memberships(uuid) from public, anon, authenticated;
revoke execute on function public.propose_swap(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.resolve_swap(uuid, uuid, text) from public, anon, authenticated;

do $$
declare
  fn   text;
  role text;
begin
  foreach fn in array array[
    'public.emit_notification(text, uuid, text, text, uuid, jsonb, text)',
    'public.claim_notifications(int)',
    'public.confirm_booking(uuid, uuid, text)',
    'public.cancel_booking(uuid, uuid, text, boolean)',
    'public.reschedule_booking(uuid, timestamptz, timestamptz, uuid, text)',
    'public.book_with_credit(uuid, uuid, timestamptz, timestamptz)',
    'public.grant_pack_credits(uuid, text)',
    'public.emit_roll_alert(uuid)',
    'public.approve_membership_period(uuid, uuid, text)',
    'public.pay_period_cash(uuid, uuid)',
    'public.release_membership(uuid, uuid, text)',
    'public.set_membership_locked(uuid, boolean, text)',
    'public.roll_memberships(uuid)',
    'public.propose_swap(uuid, uuid, uuid)',
    'public.resolve_swap(uuid, uuid, text)'
  ] loop
    foreach role in array array['anon', 'authenticated'] loop
      if has_function_privilege(role, fn, 'execute') then
        raise exception 'privilege leak: % can execute %', role, fn;
      end if;
    end loop;
  end loop;
  if has_function_privilege('anon', 'public.retry_notification(uuid)', 'execute') then
    raise exception 'privilege leak: anon can execute retry_notification(uuid)';
  end if;
end;
$$;
