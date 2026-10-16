#!/usr/bin/env bash
# Wipe the test data from the (single) Supabase project before launch.
#
#   scripts/reset-data.sh <email-of-the-admin-to-keep>
#
# DELETES, permanently:
#   - every turno, payment, session balance and balance movement
#   - every abono (membership), its schedule, its cuotas and swap offers
#   - WhatsApp message log, push subscriptions of deleted users
#   - every user account EXCEPT the one given (login + profile)
#   - every uploaded receipt in the `receipts` bucket
# KEEPS: plans (services), availability (sectors, sector_hours, beds), Google sync state, and the
# one admin account.
#
# NOT handled: Google Calendar. Events of deleted turnos stay in the calendar and
# keep blocking those slots — the script lists the future ones so you can remove
# them by hand.
set -euo pipefail
cd "$(dirname "$0")/.."

keep="${1:-}"
[[ "$keep" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] \
  || { echo "usage: $0 <email-of-the-admin-to-keep>" >&2; exit 1; }

sql() { pnpm exec supabase db query --linked "$1"; }

echo "── What is there now ──────────────────────────────────────────────"
sql "select
  (select count(*) from auth.users)             as users,
  (select count(*) from public.bookings)        as turnos,
  (select count(*) from public.payments)        as payments,
  (select count(*) from public.credit_ledger)   as balance_movements,
  (select count(*) from storage.objects where bucket_id = 'receipts') as receipts,
  (select count(*) from public.profiles
     where lower(email) = lower('$keep') and is_admin) as admin_to_keep_found"
echo "── Future turnos with a Google Calendar event (delete these by hand) ──"
sql "select b.starts_at, p.full_name, b.status from public.bookings b
     join public.profiles p on p.id = b.user_id
     where b.google_event_id is not null and b.starts_at > now()
     order by b.starts_at"

echo
echo "This deletes ALL of the above except the account $keep. It cannot be undone."
read -r -p "Type the email again to confirm: " again
[ "$again" = "$keep" ] || { echo "✗ did not match — nothing was changed" >&2; exit 1; }

# One statement = one transaction: if the admin is not found, nothing is deleted.
sql "do \$\$
declare
  keep_id uuid;
begin
  select u.id into keep_id
  from auth.users u join public.profiles p on p.id = u.id
  where lower(u.email) = lower('$keep') and p.is_admin;
  if keep_id is null then
    raise exception 'no ADMIN account with email %', '$keep';
  end if;

  delete from public.credit_ledger;
  delete from public.user_credits;
  delete from public.swap_requests;
  -- payments and membership_periods reference each other: unlink, then delete.
  update public.membership_periods set payment_id = null;
  delete from public.payments;
  delete from public.membership_periods;
  delete from public.bookings;
  delete from public.membership_slots;
  delete from public.memberships;
  delete from public.whatsapp_messages;
  delete from public.push_subscriptions where user_id <> keep_id;
  -- profiles (and anything still hanging off them) cascade from auth.users.
  delete from auth.users where id <> keep_id;
end \$\$;"

echo "→ Removing receipt files"
pnpm exec supabase storage rm -r ss:///receipts --linked --experimental --yes || \
  echo "⚠ could not empty the receipts bucket — do it from the dashboard (Storage → receipts)"

echo "── After ──────────────────────────────────────────────────────────"
sql "select
  (select count(*) from auth.users)      as users,
  (select count(*) from public.bookings) as turnos,
  (select count(*) from public.payments) as payments,
  (select count(*) from public.services) as plans_kept"
