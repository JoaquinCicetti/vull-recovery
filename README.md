# Centro de Recuperación — online booking

Simple appointment-booking system for a recovery center, built for **zero fixed
monthly cost**: a landing with plans and prices, real-time availability from
Google Calendar, light email-OTP login, payments via Mobbex (with a manual
transfer-receipt fallback), and WhatsApp coordination.

> The client-facing UI is in **Spanish** (the center's clients are in Argentina).
> These docs are in **English**.

## Documentation

- **[Setup, step by step](docs/setup.md)** — from zero to running, every env var,
  each integration (Google Calendar, Mobbex, WhatsApp), and production deploy.
- **[Architecture](docs/architecture.md)** — components, data model, request flow,
  and the key mechanisms (no-double-booking, holds, availability).
- **[Deploy to your domain](docs/deploy.md)** — Vercel (or self-host), custom domain,
  and the Supabase/Google URL wiring the live site needs.
- **[Decision records (ADRs)](docs/adr/README.md)** — *why* it's built this way:
  the zero-cost constraint, the WhatsApp 24h window, Mobbex vs. plain transfers,
  email OTP, etc.

## Stack

- **Next.js 16** (App Router, Tailwind) — free hosting (Vercel/Cloudflare).
- **Supabase** free tier — Postgres + RLS, Auth (email OTP), Storage, Edge Functions.
- **Google Calendar API** — availability (free).
- **Mobbex** — payments (per-transaction, no monthly fee); manual receipt fallback.
- **WhatsApp** — `wa.me` deep links (the client messages first → free 24h window).

## How the flow works

```
pick a plan → email-OTP login → see open slots → book (slot is held)
→ pay (Mobbex or transfer) → confirmed → coordinate on WhatsApp
```

No double-booking is guaranteed at the database level (a Postgres `EXCLUDE`
constraint), so two simultaneous clients can't grab the same slot.

## Quick start (local)

```bash
pnpm install
pnpm dlx supabase start        # local stack (needs Docker)
pnpm dlx supabase db reset     # apply schema + seed services
# put the printed API URL + anon key into .env.local (see .env.example)
pnpm dev                       # http://localhost:3000
```

OTP login codes land in Mailpit at http://localhost:54324. Full instructions,
admin setup, and every integration are in **[docs/setup.md](docs/setup.md)**.

## Project structure

```
app/        pages (landing, login, reservar, turno, mis-turnos, cuenta, admin)
lib/        helpers (supabase clients, auth, formatting, site/brand)
supabase/
  migrations/   schema + RLS + EXCLUDE constraint + receipts bucket
  functions/    availability · create-booking · create-payment ·
                mobbex-webhook · whatsapp-webhook · admin-payment · keep-alive
docs/       setup.md · architecture.md · adr/
```

## Status & roadmap

- Built; passes typecheck, lint, and a production build.
- **Pending:** end-to-end validation against the local Supabase stack (needs Docker).
- **Deferred** (see ADRs): transactional confirmation email (Resend free tier),
  in-chat WhatsApp Flows, proactive reminders.
