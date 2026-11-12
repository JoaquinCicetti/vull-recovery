# VULL — online booking for a recovery centre

Booking and payments for VULL, a sports-recovery and pilates centre in Rosario,
Argentina. Clients see the plans, pick a slot, pay by bank transfer and get
confirmed automatically. The team runs the agenda, clients and stats from an
admin panel. The overriding constraint is **zero fixed monthly cost**
([ADR 0001](docs/adr/0001-zero-fixed-monthly-cost.md)).

> The UI is in **Spanish** (the clients are in Argentina). Code and docs are in
> **English**.

## Stack

| Layer | What |
|-------|------|
| Frontend | **Next.js 16** (App Router, React 19, Tailwind 4), deployed as a **Cloudflare Worker** with `@opennextjs/cloudflare` (`wrangler.jsonc`, `open-next.config.ts`). |
| Backend | **Supabase** cloud project: Postgres with RLS, Auth (email OTP, plus Google sign-in), Edge Functions in Deno (`supabase/functions`). Database in AWS `us-west-2`; the Worker is placed in the same region ([ADR 0015](docs/adr/0015-latency-worker-at-db-region-one-round-trip.md)). |
| Payments | **Talo** automatic bank transfers, on Talo's hosted page, with discount coupons ([ADR 0010](docs/adr/0010-payments-talo-transfers.md), [0014](docs/adr/0014-no-manual-confirmation-admin-slot-blocks.md), [0016](docs/adr/0016-coupons-and-talo-hosted-page.md)). No manual receipts, no manual "mark paid". |
| Availability | Admin-defined slots per sector, minus **Google Calendar** busy blocks (optional) ([ADR 0006](docs/adr/0006-google-calendar-availability.md), [0012](docs/adr/0012-admin-defined-slots-and-booking-window.md)). |
| Notifications | An outbox table ([ADR 0013](docs/adr/0013-notification-outbox.md)); email via **Resend**, web push with VAPID keys, `notify-dispatch` as the retry cron. |
| WhatsApp | `wa.me` deep links only, so the client writes first and the conversation is free ([ADR 0002](docs/adr/0002-whatsapp-client-initiated-window.md)). |

## How it works

```
pick a plan → sign in (email code) → pick a slot (held) → pay on Talo's page
→ Talo webhook confirms the turno → client and admins are notified
```

- **Sectors.** Recovery and Pilates. They never share a screen in the admin
  panel. Pilates also sells monthly memberships ("abonos",
  [ADR 0011](docs/adr/0011-memberships-as-materialized-bookings.md)). Clients
  can also buy session packs and book with a credit.
- **No double-booking** is enforced by Postgres (an `EXCLUDE` constraint and a
  one-per-day unique index), not by app code
  ([ADR 0007](docs/adr/0007-db-level-no-double-booking.md),
  [0009](docs/adr/0009-booking-invariants-enforcement.md),
  [booking invariants](docs/booking-invariants.md)).
- **A turno is confirmed only by money or a pack credit.** `talo-webhook` (and
  the `talo-reconcile` sweep) re-fetch the payment from Talo before confirming.
  Cash at the desk is an admin **slot block** under the client's name.
- **Admin panel** (`/admin`): **Agenda**, **Clientes**, **Métricas**,
  **Ajustes**.
- **Post-session surveys** ([ADR 0017](docs/adr/0017-manual-whatsapp-surveys.md)):
  an admin sends a `wa.me` link from Agenda › past turnos, the client answers at
  `/encuesta/[bookingId]`, and the stats are in Métricas › Encuestas.

## Quick start

Development runs against the **cloud** Supabase project. There is no local
Supabase stack.

```bash
git clone <repo-url> vull-recovery && cd vull-recovery
pnpm install
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
# (Supabase dashboard → Connect / Settings → API Keys). Keep
# NEXT_PUBLIC_SITE_URL=http://localhost:3000.
pnpm dev            # http://localhost:3000
```

Sign-in codes arrive by real email. To pay locally, set
`NEXT_PUBLIC_TALO_ENABLED=true` in `.env.local`. Full setup from zero, every
env var and every integration: [docs/setup.md](docs/setup.md). Daily workflow
and checks: [docs/development.md](docs/development.md).

## Scripts

| Command | Does |
|---------|------|
| `pnpm dev` | Next.js dev server on `:3000` |
| `pnpm build` | Production Next.js build |
| `pnpm lint` | ESLint |
| `pnpm exec tsc --noEmit` | Type-check (no script; CI runs it) |
| `pnpm preview` | Build the Worker and run it locally (`opennextjs-cloudflare preview`) |
| `pnpm deploy` | `scripts/deploy.sh` → production mode |
| `pnpm deploy:dev` | `scripts/deploy.sh dev` → dev mode (Talo sandbox, "Simular pago", DEV badge) on the same site |
| `pnpm cf-typegen` | Regenerate `cloudflare-env.d.ts` from `wrangler.jsonc` |

Edge functions (from `supabase/functions`):
`pnpm dlx deno@2 check */index.ts _shared/*.ts` and `pnpm dlx deno@2 test _shared/`.

## Repository layout

```
app/                 Next.js routes: landing, /planes, /login, /reservar, /turno,
                     /comprar, /abono, /mis-turnos, /cuenta, /encuesta, /admin/*
components/          UI components (admin/, account/, landing/, experience/, survey/, ui/ …)
lib/                 Supabase clients, auth helpers, formatting, site/brand config
middleware.ts        Supabase session refresh on every request
public/              Static assets
supabase/
  migrations/        Schema, RLS, RPCs (YYYYMMDDHHMMSS_name.sql)
  functions/         Edge functions (one folder each) + _shared/ modules and tests
  templates/         Auth email template (code only)
  config.toml        Auth settings and per-function verify_jwt
  .env.secrets.example   Canonical list of edge-function secrets
scripts/
  deploy.sh          The deploy (Worker, Supabase mode secrets, checks)
  reset-data.sh      Wipe test data before launch (destructive)
docs/                Everything below
```

## Documentation

**Getting started and operations**

- [Setup, step by step](docs/setup.md): from zero to running, every env var and
  edge secret, each integration (Talo, Resend, Google Calendar, WhatsApp, push).
- [Development workflow](docs/development.md): running locally, checks before
  committing, migrations, notification kinds, commit conventions, ADRs.
- [Deploy](docs/deploy.md): Cloudflare Worker, migrations, edge functions,
  release order and checklist.
- [Runbook: manual testing](docs/runbooks/manual-testing.md): checks to run by
  hand before and after a deploy.
- [Runbook: moving Supabase to sa-east-1](docs/runbooks/supabase-region-move.md).

**Design**

- [Architecture](docs/architecture.md): components, data model, request flow,
  edge functions.
- [Booking invariants](docs/booking-invariants.md): the rules every booking path
  must enforce.
- [Experience architecture](docs/experience-architecture.md): the landing's
  scroll-driven WebGL scene.
- [SEO](docs/seo.md).
- [Architecture Decision Records](docs/adr/README.md): why it is built this way
  (0001–0017).

**Historical snapshots** (not kept up to date)

- [Audit, 2026-08](docs/audit-2026-08.md)
- [Audit and roadmap](docs/audit-and-roadmap.md)

Product and design notes: [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md).
