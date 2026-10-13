-- ============================================================================
-- Cancelling a PAID turno returns the session as a credit (24h notice rule)
-- ============================================================================
-- Before this, cancelling a turno paid directly (Talo or manual transfer) kept
-- the money and gave the client nothing — and a pack-credit turno got its credit
-- back even when cancelled an hour before. One rule now covers every paid turno:
--
--   * client cancels >= 24h before starts_at  → one credit for that service
--   * client cancels later                    → nothing (admin can adjust_credit)
--   * admin / Google Calendar cancellation     → always one credit
--
-- "Paid" = funded by a pack credit (booking_consume row) OR an approved,
-- non-reversed booking payment. Money is never sent back automatically.

alter table public.credit_ledger drop constraint credit_ledger_reason_check;
alter table public.credit_ledger add constraint credit_ledger_reason_check
  check (reason in ('purchase','booking_consume','booking_refund','cancel_credit',
                    'admin_adjust','revoke'));

-- At most ONE return per booking, whichever way it was funded.
create unique index if not exists credit_ledger_return_uniq
  on public.credit_ledger (booking_id)
  where reason in ('booking_refund', 'cancel_credit');

-- Returns 'credited' | 'late' | 'unpaid' | 'already' | 'not_cancelled'.
create or replace function public.return_cancelled_booking(
  p_booking_id uuid,
  p_by_admin   boolean,
  p_min_notice interval default interval '24 hours'
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

  if not p_by_admin
     and b.starts_at - coalesce(b.cancelled_at, now()) < p_min_notice then
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
