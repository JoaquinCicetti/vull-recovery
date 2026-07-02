-- ============================================================================
-- Simplify packs: a plan IS a pack when sessions_included > 1 (self-granting)
-- ============================================================================
-- Original model made a pack a separate service pointing at another bookable
-- service (grants_service_id) — needless. New model: a service with
-- sessions_included > 1 is a pack; buying it grants that many credits for ITSELF,
-- and each booking of that service spends one. Recreate grant_pack_credits to
-- grant for the service itself, then drop grants_service_id.

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

  return svc.sessions_included;
end;
$$;

alter table public.services drop column if exists grants_service_id;
