-- ============================================================================
-- Per-user notification preferences (client-facing email / push opt-out).
-- ============================================================================
-- Clients receive booking emails and (new) Web Push. These two flags let a user
-- turn either channel off from /cuenta. Default true so existing behaviour is
-- unchanged for everyone until they opt out.

alter table public.profiles
  add column notify_email boolean not null default true,
  add column notify_push  boolean not null default true;

-- The privilege guard (20260630120000) revoked the table-level UPDATE grant and
-- re-granted only (full_name, whatsapp_phone), so the browser can physically write
-- nothing else. These preference columns must be added to that grant or a
-- self-update from /cuenta errors and the toggles silently do nothing. The
-- guard_profile_privileges trigger only pins is_admin/email, so it passes these.
grant update (notify_email, notify_push) on public.profiles to authenticated;
