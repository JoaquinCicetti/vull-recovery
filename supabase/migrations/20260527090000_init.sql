-- ============================================================================
-- Recovery center — initial schema
-- services · profiles · bookings · payments · whatsapp_messages · settings
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists btree_gist;  -- gist over scalar + range (future multi-resource)

-- ─── enums ───────────────────────────────────────────────────────────────────
create type public.booking_status  as enum ('pending','awaiting_payment','confirmed','cancelled','expired');
create type public.payment_provider as enum ('mobbex','manual');
create type public.payment_status   as enum ('pending','approved','rejected');

-- ─── services (the plans / cards on the landing) ─────────────────────────────
create table public.services (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  price_ars        integer not null check (price_ars >= 0),
  duration_minutes integer not null check (duration_minutes > 0),
  active           boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);

-- ─── profiles (1:1 with auth.users) ──────────────────────────────────────────
create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text,
  whatsapp_phone text,
  is_admin       boolean not null default false,
  created_at     timestamptz not null default now()
);

-- ─── helper: am I an admin? (SECURITY DEFINER avoids RLS recursion) ──────────
-- Owned by postgres (BYPASSRLS), so the inner read of profiles skips RLS.
-- Defined after public.profiles exists, since a `language sql` body is
-- validated against referenced relations at creation time.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ─── bookings ────────────────────────────────────────────────────────────────
create table public.bookings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  service_id      uuid not null references public.services(id),
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  -- materialized range used by the no-overlap constraint
  during          tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  status          public.booking_status not null default 'pending',
  google_event_id text,
  hold_expires_at timestamptz,
  created_at      timestamptz not null default now(),
  constraint bookings_time_valid check (ends_at > starts_at)
);

-- Single-resource center: no two *active* bookings may overlap in time.
-- DB-level guarantee against the slot race condition (two clients, same slot).
-- (For multi-room later: add resource_id and `resource_id with =` to this list.)
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (during with &&)
  where (status in ('pending','awaiting_payment','confirmed'));

create index bookings_user_idx       on public.bookings (user_id);
create index bookings_starts_at_idx  on public.bookings (starts_at);
create index bookings_status_idx     on public.bookings (status);

-- ─── payments ─────────────────────────────────────────────────────────────────
create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references public.bookings(id) on delete cascade,
  provider           public.payment_provider not null,
  amount_ars         integer not null,
  status             public.payment_status not null default 'pending',
  mobbex_checkout_id text,
  external_reference text,        -- == booking_id, sent to/echoed by Mobbex
  receipt_path       text,        -- Storage path for manual transfer proof
  raw                jsonb,       -- last webhook payload (debugging/audit)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index payments_booking_idx on public.payments (booking_id);

-- ─── whatsapp_messages (conversation log + 24h free-window tracking) ─────────
create table public.whatsapp_messages (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid references public.profiles(id) on delete set null,
  phone             text,
  direction         text not null check (direction in ('inbound','outbound')),
  body              text,
  wa_message_id     text,
  window_expires_at timestamptz,   -- when the free reply window closes
  created_at        timestamptz not null default now()
);

-- ─── settings (singleton row of center config) ───────────────────────────────
create table public.settings (
  id                  boolean primary key default true,
  working_hours_start time   not null default '09:00',
  working_hours_end   time   not null default '18:00',
  working_days        int[]  not null default '{1,2,3,4,5}',  -- 0=Sun .. 6=Sat
  timezone            text   not null default 'America/Argentina/Buenos_Aires',
  constraint settings_singleton check (id)
);
insert into public.settings (id) values (true);

-- ─── updated_at maintenance for payments ─────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger payments_touch_updated_at
  before update on public.payments
  for each row execute function public.touch_updated_at();

-- ─── auto-create a profile on signup ─────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Row Level Security
-- Edge Functions use the service_role key (BYPASSRLS), so writes that need the
-- overlap guard / hold logic happen server-side. Policies below cover the
-- browser (anon/authenticated) surface only.
-- ============================================================================

alter table public.services          enable row level security;
alter table public.profiles          enable row level security;
alter table public.bookings          enable row level security;
alter table public.payments          enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.settings          enable row level security;

-- services: public reads active ones; admin manages all
create policy services_read on public.services
  for select using (active or public.is_admin());
create policy services_admin_write on public.services
  for all using (public.is_admin()) with check (public.is_admin());

-- profiles: see/edit own row; admin sees all
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy profiles_insert_own on public.profiles
  for insert with check (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_update on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- bookings: read own (or admin). Writes are server-side (service role).
create policy bookings_select_own on public.bookings
  for select using (user_id = auth.uid() or public.is_admin());

-- payments: read those tied to your own booking (or admin). Writes server-side.
create policy payments_select_own on public.payments
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id and b.user_id = auth.uid()
    )
  );

-- whatsapp_messages: admin only on the browser. Writes server-side.
create policy whatsapp_admin_read on public.whatsapp_messages
  for select using (public.is_admin());

-- settings: public read (landing/hours); admin updates
create policy settings_read on public.settings
  for select using (true);
create policy settings_admin_write on public.settings
  for update using (public.is_admin()) with check (public.is_admin());

-- Services are created/managed by the admin via /admin/servicios — no seed data.
