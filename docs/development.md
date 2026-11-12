# Development workflow

How to work on the code day to day. First-time setup is in
[setup.md](setup.md); shipping is in [deploy.md](deploy.md).

## Running locally

```bash
pnpm dev        # Next.js on http://localhost:3000, against the cloud Supabase project
pnpm preview    # optional: build the real Worker and run it locally
```

- There is **no local Supabase stack**. `pnpm dev` reads `.env.local` and talks
  to the cloud project, so the data you create is real: clean it up from the
  admin panel.
- Edge functions run on the cloud project. To try a function change you deploy
  it (`pnpm exec supabase functions deploy <name>`), which affects the live
  site. Keep function changes backwards compatible, or ship them together with
  the frontend (see the release order in [deploy.md](deploy.md#release-order)).
- To test payments without real money, switch the site to the Talo sandbox with
  `pnpm deploy:dev`, and back with `pnpm deploy` when done.
- Inspect data with `pnpm exec supabase db query --linked "select …"` or the
  dashboard's SQL editor.

## Checks before committing

CI (`.github/workflows/ci.yml`) runs two jobs on every push to `main` and every
pull request: **Web** (`pnpm install --frozen-lockfile`, `pnpm exec tsc --noEmit`,
`pnpm lint`) and **Edge functions** (`deno check */index.ts _shared/*.ts` and
`deno test _shared/` in `supabase/functions`). Run the same locally, plus a
build:

```bash
pnpm exec tsc --noEmit     # types (there is no "typecheck" script)
pnpm lint                  # ESLint
pnpm build                 # Next.js production build

cd supabase/functions
pnpm dlx deno@2 check */index.ts _shared/*.ts   # Deno is not on PATH
pnpm dlx deno@2 test _shared/
```

Tests live next to the code as `_shared/*_test.ts`.

## Writing a migration

- One file per change in `supabase/migrations/`, named
  `YYYYMMDDHHMMSS_snake_case.sql` (e.g. `20261112120000_session_surveys.sql`).
  The timestamp must be later than every existing file.
- Start with a comment saying what the migration does and which ADR it belongs
  to.
- Never edit a migration that has been applied; write a new one.
- Every new table gets `enable row level security` and explicit policies.
  Writes that carry logic go through `security definer` RPCs or edge functions.
- Apply it with `pnpm exec supabase migration list` then
  `pnpm exec supabase db push`. Nothing applies migrations automatically, and
  `scripts/deploy.sh` refuses to deploy while one is pending.
- If the frontend reads a new table or column, the migration must be applied
  **before** the frontend ships.
- PostgREST embeds from `bookings` to `profiles` must name the FK
  (`profiles!user_id(...)`): there are two foreign keys between them.

## Adding a notification kind

A kind is a `notifications.kind` value with a renderer per audience
([ADR 0013](adr/0013-notification-outbox.md)). Three places must agree:

1. **The CHECK constraint.** In a new migration, drop and re-add
   `notifications_kind_check` with the full list plus the new kind (see the end
   of `20261112120000_session_surveys.sql`). Emit it with `emit_notification`
   inside the transaction that causes it, or `emit()` from an edge function.
2. **The renderer.** Add the kind to `RENDERERS` in
   `supabase/functions/_shared/notify-render.ts`, with a renderer for each
   audience (`user`, `admins`) that receives it.
3. **The test.** In `supabase/functions/_shared/notify_test.ts`, add each
   emitted `(kind, audience)` pair to `EMITTED` and the kind to `KINDS`. The
   tests fail if the renderer table and the CHECK list disagree.

Then run `pnpm dlx deno@2 test _shared/`, apply the migration, and redeploy
every function that imports `_shared/notify.ts`
([deploy.md › Edge functions](deploy.md#edge-functions)).

## Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <imperative subject>

<body: why the change was made, and anything a reviewer needs to know>
```

- **Types:** `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`,
  `chore`, `revert`, `style`.
- **Scope** is optional and names the area: `admin`, `surveys`, `landing`,
  `payments`, …
- **Subject** in the imperative ("add", not "added"), lower case, no trailing
  period, around 72 characters at most.
- **Body** explains *why*. List notable pieces as bullets when a commit touches
  several surfaces. Reference the ADR when the commit implements one.
- No co-author or tool trailers.

Examples from the history:

```
feat(surveys): session_surveys table, RPCs, survey_submitted notice, plan stations
refactor(admin): Ajustes as a settings list, each setting edited in a dialog
revert(landing): restore the original hero; move Dónde estamos below the plans
```

## Branches

- `main` is what gets deployed. Branch from it for every change, named
  `<type>/<short-name>` with the same types as commits (e.g. `feat/pilates`,
  `fix/experience-logo-hitch`, `chore/cloudflare-dev-mode`).
- Open a pull request into `main`; CI must pass.
- Deploys are manual, so merging does not ship anything. Follow the
  [release checklist](deploy.md#release-checklist).

## When to write an ADR

Write one in `docs/adr/` when a decision is hard to reverse or would surprise
the next person: a new provider or paid dependency, a data-model choice, a
rule the database enforces, a change to how money or notifications move, or a
deliberate "we won't do X". Bug fixes and refactors don't need one.

- **Number:** the next after the highest in `docs/adr/` (currently 0017, so
  0018), file `NNNN-kebab-case-title.md`.
- **Template:**

  ```markdown
  # ADR NNNN — Title

  - **Status:** Proposed | Accepted | Superseded by [ADR NNNN](NNNN-….md)
  - **Date:** YYYY-MM-DD

  ## Context
  ## Decision
  ## Consequences
  ## Alternatives rejected
  ```

- Add a row to the index in [docs/adr/README.md](adr/README.md). When a
  decision replaces an older one, mark the old ADR "Superseded by" and link
  both ways.
