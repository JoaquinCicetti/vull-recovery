-- ============================================================================
-- profiles.email — surface the client's email to the admin schedule
-- ============================================================================
-- auth.users.email isn't readable from the browser (even by admins via RLS), so
-- mirror it onto profiles. Kept in sync by the signup trigger; backfilled below.

alter table public.profiles add column if not exists email text;

-- Recreate the signup handler to also copy the email.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end; $$;

-- Backfill existing profiles from auth.users.
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;
