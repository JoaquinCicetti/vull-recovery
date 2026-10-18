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
                                   • create-payment    ─────────▶  Talo (CVU/alias)
                                   • talo-webhook      ◀─────────  Talo (notification)
                                   • talo-reconcile    ─────────▶  Talo (GET /payments)
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
| `services` | Plans/cards: name, price (ARS), duration (shown to the client; the turno length is the sector's slot), active |
| `profiles` | 1:1 with `auth.users`: name, WhatsApp, `is_admin` |
| `bookings` | Appointments: time range, status, calendar event, hold expiry |
| `payments` | Payments: provider (`talo`/`manual`, legacy `mobbex`), status, Talo id + CVU/alias, receipt, `admin_flag` |
| `whatsapp_messages` | Inbound message log + 24h window |
| `settings` | Legacy singleton (timezone read by metrics/email); agenda moved to `sectors` |
| `sectors` / `resources` | Areas (recovery, pilates) with their policies (incl. the client booking window); beds/places a turno occupies (active ones = turnos per slot) |
| `sector_hours` | Open ranges per sector and weekday (several per day allowed), each cut into `slot_minutes` turnos |
| `memberships` / `membership_slots` / `membership_periods` | Monthly plans (abonos): the client's weekly pattern, and one cuota per month. Each class is a `bookings` row with `membership_id` (ADR 0011) |
| `swap_requests` | Offers to swap a class between two members (propose → accept) |

Booking lifecycle: `pending → awaiting_payment → confirmed` (or `cancelled` / `expired`).

## Key mechanisms

- **No double-booking (DB-level).** `bookings` has an
  `EXCLUDE USING gist (during WITH &&) WHERE <active status>` constraint. Two
  clients booking the same slot at once: Postgres rejects the second insert
  (code `23P01`). Not dependent on application logic. See [ADR 0007](adr/0007-db-level-no-double-booking.md).
- **One turno per day (DB-level).** A partial UNIQUE index
  `bookings_one_per_day` on `(user_id, booking_local_date(starts_at))` over the
  active statuses guarantees a user holds at most one active booking per local
  day (race-safe; code `23505`). See [ADR 0009](adr/0009-booking-invariants-enforcement.md).
- **Server-side slot re-validation.** `create-booking` re-checks the submitted
  time (working hours/days, lead, grid, booking window, Google freeBusy) via the shared
  `_shared/booking-rules.ts`, the same logic `availability` uses, so a crafted or
  stale request can't book outside the rules. Full contract:
  [docs/booking-invariants.md](booking-invariants.md).
- **Hold with expiry.** Booking creates a `pending` row with `hold_expires_at`
  (~10 min). Expired holds are freed **lazily** (at the start of `availability`
  and `create-booking`) — no cron.
- **Availability.** `availability` walks the sector's booking window (recovery:
  the current Mon–Sun week, the next one from Sunday 14:00; pilates: the next 14
  days), cuts each open range (`sector_hours`) into its admin-defined
  `slot_minutes` turnos, subtracts Google Calendar busy blocks (`freeBusy`), and
  keeps a slot while any active resource is free for it. A turno is exactly one
  slot; the plan's duration is only displayed. If Google isn't configured, it
  uses DB bookings only. See [ADR 0012](adr/0012-admin-defined-slots-and-booking-window.md).
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
   - **Talo** → inserts the payment row, mints a one-time CVU/alias (`external_id` = row id)
     and extends the booking hold to the CVU's expiry. The booking stays `pending`.
   - **Manual** → records the uploaded receipt to Storage, sets `awaiting_payment`.
6. Confirmation:
   - **Talo** → `talo-webhook` (or the `talo-reconcile` cron) re-fetches the payment from
     Talo, checks the amount actually received, confirms the booking, finalizes the event.
   - **Manual** → admin reviews the receipt in `/admin` and approves (`admin-payment`).
7. Client taps **"Confirmar por WhatsApp"** (`wa.me`): by messaging first, we can
   reply free within the 24h window. See [ADR 0002](adr/0002-whatsapp-client-initiated-window.md).

## Edge Functions (`supabase/functions/`)

| Function | JWT | Does |
|----------|-----|------|
| `availability` | public | Computes free slots |
| `create-booking` | user | Race-safe hold + tentative event |
| `create-payment` | user | Talo CVU / manual receipt (legacy Mobbex branch pending removal) |
| `talo-webhook` | public* | Notification → re-verify with Talo → settle (`_shared/talo-settle.ts`) |
| `talo-reconcile` | cron* | Re-checks unsettled Talo payments through the same settle path |
| `mobbex-webhook` | public* | Legacy; to be deleted (ADR 0010) |
| `admin-payment` | admin | Approve / reject / dismiss a payment needing a human |
| `whatsapp-webhook` | public* | Meta verify + inbound logging |
| `keep-alive` | public | Ping so the free project doesn't pause |
| `membership-availability` | public | Free beds per weekday/time across a whole month (abono picker) |
| `membership` | user | Create an abono, lock/unlock renewal, drop an unpaid signup |
| `admin-membership` | admin | Desk sale (creates the client's account if needed), cash cuota, release, lock |
| `swap-booking` | user | Move an abono class to a free slot; propose/accept/decline/cancel swaps |
| `membership-cycle` | cron* | Daily roll of recurring members + roll-error alert |

\* Webhooks authenticate via their own secret/token, not a Supabase JWT.
