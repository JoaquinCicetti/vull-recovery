-- ============================================================================
-- Monthly plans (abonos): billing mode on plans, billing policy on sectors
-- ============================================================================
-- A plan is either paid per session (what exists today, including packs) or
-- monthly: the client keeps `classes_per_week` fixed weekly classes and pays
-- price_ars per calendar month. The membership tables come in
-- 20261015150000_memberships.sql; this file only adds the configuration.

alter table public.services
  add column billing          text not null default 'session',
  add column classes_per_week int,
  add constraint services_billing_check check (billing in ('session', 'monthly')),
  add constraint services_monthly_shape check (
    -- monthly ⇔ it says how many classes a week
    (billing = 'monthly') = (classes_per_week is not null)
    and (classes_per_week is null or classes_per_week between 1 and 7)
    -- a monthly plan is never a pack
    and (billing <> 'monthly' or sessions_included = 1)
  );

-- When a member must pay each month, what being late costs, and from which day
-- an admin may free an unpaid slot. Days of the month, local to the sector.
alter table public.sectors
  add column due_day      int not null default 10,
  add column late_fee_pct int not null default 10,
  add column release_day  int not null default 20,
  add constraint sectors_late_fee_range check (late_fee_pct between 0 and 100),
  add constraint sectors_billing_days check (
    due_day >= 1 and due_day < release_day and release_day <= 28
  );
