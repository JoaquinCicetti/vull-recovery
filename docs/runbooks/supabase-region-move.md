# Runbook — move the Supabase project to sa-east-1

Why: the project `wjdiojyelthaumuzkfxt` lives in `us-west-2` (Oregon). Every
visitor, the Worker, the Edge Functions and Supabase Auth are ~250 ms away from
it; São Paulo is ~40 ms from Buenos Aires. ADR 0015 made the app pay that hop
once per page instead of once per query; this move makes the hop itself short.

Supabase cannot change a project's region in place: it is a new project and a
migration. Plan ~2 h with a maintenance window of ~30 min (bookings paused:
set the sectors inactive, or put the Worker in dev mode with Talo disabled).
Every client is signed out by the move (new Auth project → new cookies); they
sign in again with an email code, nothing else to do on their side.

Prerequisites on the machine that runs it: `psql`/`pg_dump` (`brew install
libpq` and add it to PATH), the OLD project's database password (dashboard →
Project settings → Database), the Supabase CLI logged in.

## 1. Create the new project
```
pnpm exec supabase projects create "Vull recovery" --org-id cslbgfmlobyhswocudzq \
  --region sa-east-1 --db-password '<new strong password>'
```
Note the new ref. In the dashboard of the new project: Auth → enable the email
provider and Google (same client id/secret as the old one), set Site URL
`https://www.vull.com.ar` and the redirect URL `https://www.vull.com.ar/auth/callback`;
Auth → JWT → create an ES256 signing key (the app verifies tokens locally).

## 2. Schema
From the repo, link the new project and push the migrations (`supabase/migrations`
is the source of truth; `supabase migration list` must show everything applied):
```
pnpm exec supabase link --project-ref <new-ref>
pnpm exec supabase db push
pnpm exec supabase config push --yes       # auth email templates (code, not link)
```

## 3. Data
Dump the OLD project's data (not schema) with the CLI against its direct
connection, then restore into the new one. `auth` holds users and identities;
`storage` holds the legacy receipt objects' metadata (the files themselves are
history only — skip them unless needed).
Take each project's connection string from its dashboard (Connect → Session
pooler, port 5432; percent-encode the password):
```
OLD='<old project session-pooler URL>'
NEW='<new project session-pooler URL>'
pnpm exec supabase db dump --db-url "$OLD" --data-only --use-copy --schema auth -f auth.sql
pnpm exec supabase db dump --db-url "$OLD" --data-only --use-copy -f public.sql
psql "$NEW" -v ON_ERROR_STOP=1 -c 'set session_replication_role = replica' -f auth.sql
psql "$NEW" -v ON_ERROR_STOP=1 -c 'set session_replication_role = replica' -f public.sql
```
`session_replication_role = replica` keeps triggers (notification outbox,
sector stamping) quiet during the load. Check row counts on both sides for
`profiles`, `bookings`, `memberships`, `membership_periods`, `payments`,
`user_credits`, `credit_ledger`, `notifications`.

## 4. Secrets and functions
```
pnpm exec supabase secrets set --env-file supabase/.env.prod            # Talo
pnpm exec supabase secrets set --env-file supabase/.env.secrets         # the rest (see .env.secrets.example)
pnpm exec supabase functions deploy                                      # all functions
```
Then the external services that point at the old project:
- **Talo** webhook URL → `https://<new-ref>.supabase.co/functions/v1/talo-webhook`.
- **Google Calendar** sync: the stored `google_sync_token`s came across with the
  data; they stay valid (they belong to the calendar, not the project).
- **Cron jobs** (notify-dispatch, membership-cycle, Talo reconcile): recreate
  them on the new project with the new URL and tokens.

## 5. The site
- `.env.production`: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  of the new project.
- `lib/supabase/client.ts`: the `x-region` header becomes `sa-east-1`.
- `wrangler.jsonc`: `placement.region` becomes `aws:sa-east-1`.
- `lib/supabase/middleware.ts` matches cookies by the `sb-` prefix, nothing to change.
- `pnpm deploy`, then verify `curl -sI https://www.vull.com.ar/login | grep cf-placement`
  says `remote-GRU` (or another São Paulo code) and that an admin login reaches
  the agenda.

## 6. Afterwards
Keep the old project paused (not deleted) for two weeks in case something was
missed, then delete it. Update `docs/architecture.md`, the memory notes and
ADR 0015's region.
