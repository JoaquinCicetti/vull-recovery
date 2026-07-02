-- ============================================================================
-- Notifications infrastructure
--   push_subscriptions — Web Push endpoints per user (owner devices get alerts)
--   calendar_sync      — Google Calendar watch/poll state (single row)
-- ============================================================================

-- ─── Web Push subscriptions ──────────────────────────────────────────────────
-- One row per browser/device subscription. The browser upserts its OWN row
-- (own-row RLS, like profiles self-edit); the service-role push sender reads all
-- admin subscriptions and prunes dead ones (404/410) via failure_count/delete.
create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  failure_count int  not null default 0,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_own on public.push_subscriptions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ─── Google Calendar sync state (singleton) ─────────────────────────────────
-- Holds the incremental sync token + (optional) watch-channel identifiers. The
-- sync token must NOT be publicly readable, so — unlike `settings` — this table
-- has NO select policy: only the service role / SECURITY DEFINER paths touch it.
create table public.calendar_sync (
  id                 boolean primary key default true check (id),
  channel_id         text,
  resource_id        text,
  channel_expiration timestamptz,
  sync_token         text,
  last_polled_at     timestamptz,
  updated_at         timestamptz not null default now()
);
insert into public.calendar_sync (id) values (true);

alter table public.calendar_sync enable row level security;
-- (no policies → browser clients cannot read or write; service role bypasses RLS)

create trigger calendar_sync_touch_updated_at
  before update on public.calendar_sync
  for each row execute function public.touch_updated_at();
