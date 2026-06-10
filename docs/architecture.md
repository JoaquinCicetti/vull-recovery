# Architecture

Appointment-booking system for a recovery center. Design goal: **zero fixed
monthly cost**, simple to operate. The "why" behind each choice is in the
[ADRs](adr/README.md).

## Overview

```
Next.js (Vercel, free)            Supabase (free tier)            External
─────────────────────             ────────────────────            ────────
Landing + plans           ──▶     Postgres + RLS
Email-OTP login           ──▶     Auth (email OTP)
Booking / My bookings     ──▶     Storage (receipts)
Admin panel               ──▶     Edge Functions:                 Google Calendar
                                   • availability      ─────────▶  (freeBusy)
                                   • create-booking
                                   • create-payment    ─────────▶  Mobbex (checkout)
                                   • mobbex-webhook    ◀─────────  Mobbex (IPN)
                                   • admin-payment
                                   • whatsapp-webhook  ◀─────────  WhatsApp (inbound)
                                   • keep-alive
                       client taps wa.me link ────────────────────▶  WhatsApp (messages first)
```

Sensitive logic lives in **Edge Functions** (Deno) using the service-role key, so
secrets stay server-side and webhooks have a stable URL. The browser uses the
Supabase client (anon key + RLS) for auth and reads.

## Data model (`supabase/migrations/`)

| Table | Purpose |
|-------|---------|
| `services` | Plans/cards: name, price (ARS), duration, active |
| `profiles` | 1:1 with `auth.users`: name, WhatsApp, `is_admin` |
| `bookings` | Appointments: time range, status, calendar event, hold expiry |
| `payments` | Payments: provider (`mobbex`/`manual`), status, checkout id, receipt |
| `whatsapp_messages` | Inbound message log + 24h window |
| `settings` | Singleton row: working hours, days, timezone |

Booking lifecycle: `pending → awaiting_payment → confirmed` (or `cancelled` / `expired`).

## Key mechanisms

- **No double-booking (DB-level).** `bookings` has an
  `EXCLUDE USING gist (during WITH &&) WHERE <active status>` constraint. Two
  clients booking the same slot at once: Postgres rejects the second insert
  (code `23P01`). Not dependent on application logic. See [ADR 0007](adr/0007-db-level-no-double-booking.md).
- **Hold with expiry.** Booking creates a `pending` row with `hold_expires_at`
  (~10 min). Expired holds are freed **lazily** (at the start of `availability`
  and `create-booking`) — no cron.
- **Availability.** `availability` takes working hours (`settings`), subtracts
  Google Calendar busy blocks (`freeBusy`) and active bookings, and returns free
  slots per day. If Google isn't configured, it uses DB bookings only.
- **Timezone.** `Intl`-based helpers (no deps) convert local ⇄ UTC respecting
  DST. Default `America/Argentina/Buenos_Aires`.
- **RLS.** Clients see only their own rows; `is_admin()` (SECURITY DEFINER, no
  recursion) gates the admin view. Writes with logic (holds, confirmations) go
  through service-role functions.

## Booking & payment flow

1. Client picks a service on the landing.
2. `availability` → free slots.
3. Email-OTP login + WhatsApp number in profile.
4. Pick a slot → `create-booking` writes the `pending` booking (guarded by the
   `EXCLUDE` constraint) + a tentative Calendar event.
5. `create-payment`:
   - **Mobbex** → creates a checkout (`reference` = booking id), returns the pay URL.
   - **Manual** → records the uploaded receipt to Storage, sets `awaiting_payment`.
6. Confirmation:
   - **Mobbex** → `mobbex-webhook` receives the IPN, confirms the booking, finalizes the event.
   - **Manual** → admin reviews the receipt in `/admin` and approves (`admin-payment`).
7. Client taps **"Confirmar por WhatsApp"** (`wa.me`): by messaging first, we can
   reply free within the 24h window. See [ADR 0002](adr/0002-whatsapp-client-initiated-window.md).

## Edge Functions (`supabase/functions/`)

| Function | JWT | Does |
|----------|-----|------|
| `availability` | public | Computes free slots |
| `create-booking` | user | Race-safe hold + tentative event |
| `create-payment` | user | Mobbex checkout / manual receipt |
| `mobbex-webhook` | public* | IPN → confirms booking (`status.code 200` = paid) |
| `admin-payment` | admin | Approve/reject a manual payment |
| `whatsapp-webhook` | public* | Meta verify + inbound logging |
| `keep-alive` | public | Ping so the free project doesn't pause |

\* Webhooks authenticate via their own secret/token, not a Supabase JWT.
