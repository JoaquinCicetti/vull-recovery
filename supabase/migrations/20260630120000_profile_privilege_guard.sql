-- ============================================================================
-- Harden profiles against privilege escalation (security launch blocker S1)
-- ============================================================================
-- RLS gates ROWS, not COLUMNS. Policy profiles_update_own (id = auth.uid()) plus
-- the default table-level UPDATE grant to `authenticated` let ANY signed-in user
-- run `supabase.from('profiles').update({is_admin:true}).eq('id', myUid)` in the
-- browser and become a full admin (read all PII, manage settings, approve
-- payments). Same vector overwrites the mirrored `email`.
--
-- Defense in depth, two independent layers:
--   1. Column-level grants  — the browser keys can only write full_name /
--      whatsapp_phone; is_admin and email become physically unwritable.
--   2. A BEFORE trigger      — survives any future re-GRANT; refuses an is_admin
--      change requested by a non-admin browser session.
-- Legitimate admin promotion still happens via service-role / SQL (auth.uid() is
-- NULL there), and the SECURITY DEFINER signup handler (handle_new_user, owned by
-- postgres) is unaffected by the role grants.

-- ─── 1. Column-level write lockdown for the browser-facing roles ─────────────
revoke insert, update on public.profiles from authenticated, anon;
grant  insert (id, full_name, whatsapp_phone) on public.profiles to authenticated;
grant  update (full_name, whatsapp_phone)     on public.profiles to authenticated;

-- ─── 2. Belt-and-suspenders trigger guard ───────────────────────────────────
-- is_admin() is SECURITY DEFINER and reads the COMMITTED row, so a non-admin can
-- never see itself as admin while flipping the flag. A browser request carries a
-- non-null auth.uid(); service-role/SQL promotions have auth.uid() = NULL and are
-- therefore allowed through.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only constrain real end-user (JWT-bearing) sessions; service-role/SQL pass.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.is_admin := false;        -- a self-served profile can never start admin
    return new;
  end if;

  -- UPDATE by a non-admin user: forbid privilege/email changes on their own row.
  if new.is_admin is distinct from old.is_admin then
    raise exception 'No autorizado: no podés modificar is_admin'
      using errcode = '42501';
  end if;
  new.email := old.email;          -- email is owner/auth-managed, not user-set

  return new;
end;
$$;

create trigger profiles_guard_privileges
  before insert or update on public.profiles
  for each row execute function public.guard_profile_privileges();
