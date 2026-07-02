# Step-by-step environment setup

From an empty machine to a running app, then each integration, then production.
Commands assume you're in the project root and using **pnpm**.

---

## 0. Prerequisites

- **Node 22+** and **pnpm** (`corepack enable pnpm`).
- **Docker Desktop running** (the local Supabase stack runs in Docker).

## 1. Install dependencies

```bash
pnpm install
```

## 2. Start the local Supabase stack

```bash
pnpm dlx supabase start
```

First run pulls Docker images (a few minutes). When done it prints local values —
keep them:

- `API URL` → http://127.0.0.1:54321
- `anon key`, `service_role key`
- `Studio URL` → http://127.0.0.1:54323
- `Mailpit/Inbucket URL` → http://127.0.0.1:54324 (where OTP emails land)

## 3. Create `.env.local` (frontend)

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from step 2>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
# optional in dev:
NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER=
NEXT_PUBLIC_TRANSFER_ALIAS=
```

## 4. Apply the schema

```bash
pnpm dlx supabase db reset
```

Runs the migrations (tables, RLS, the `EXCLUDE` no-overlap constraint, the
`receipts` Storage bucket) and seeds example services.

## 5. Run the app

```bash
pnpm dev
```

- App → http://localhost:3000
- Studio → http://localhost:54323
- **OTP codes** → http://localhost:54324 (Mailpit)

Sign in with any email, grab the 6-digit code from Mailpit, and you're in.

## 6. Make yourself admin

After logging in once, in Studio's SQL editor:

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'you@example.com');
```

Then `/admin` and `/admin/servicios` unlock.

## 7. Edge Function secrets (local)

The core flow (availability + booking) needs **no** external secrets. For Google
/ Mobbex / WhatsApp, put them in `supabase/functions/.env` and serve functions
with that file:

```bash
# supabase/functions/.env  (SUPABASE_URL/keys are injected automatically)
GOOGLE_SERVICE_ACCOUNT_JSON=
GOOGLE_CALENDAR_ID=
MOBBEX_API_KEY=
MOBBEX_ACCESS_TOKEN=
MOBBEX_TEST=true
MOBBEX_WEBHOOK_SECRET=some-random-string
APP_URL=http://localhost:3000
WHATSAPP_VERIFY_TOKEN=
BOOKING_HOLD_MINUTES=10
```

```bash
pnpm dlx supabase functions serve --env-file supabase/functions/.env
```

> Webhooks (Mobbex/WhatsApp) need a **public URL**. Locally, expose the functions
> port with a tunnel (e.g. `ngrok http 54321`) and point the provider at the
> tunneled `…/functions/v1/<name>` URL.

## 8. Google Calendar (availability)

1. Google Cloud Console → create/select a project.
2. Enable **Google Calendar API**.
3. Create a **Service Account** → create a **JSON key** → download it.
4. In Google Calendar, open the center's calendar → **Settings → Share with
   specific people** → add the service-account email
   (`…@<project>.iam.gserviceaccount.com`). Give "Make changes to events" if you
   want the app to also write/confirm events.
5. Calendar **Settings → Integrate calendar → Calendar ID** → copy it.
6. Set the secrets:
   - `GOOGLE_SERVICE_ACCOUNT_JSON` = the full JSON (single line)
   - `GOOGLE_CALENDAR_ID` = the calendar id

> Without this, availability is computed from DB bookings only. Working hours,
> days, and timezone live in the **`settings`** table (edit in Studio).

## 9. Mobbex (payments)

1. **mobbex.dev** → create an application → request access to the merchant entity
   (CUIT) → get the **API key** and **access token**.
2. Set `MOBBEX_API_KEY`, `MOBBEX_ACCESS_TOKEN`; set `MOBBEX_TEST=true` for sandbox.
3. Choose any random `MOBBEX_WEBHOOK_SECRET`. **Required.** It's appended as
   `?token=…` to the webhook URL and checked by `mobbex-webhook` (Mobbex doesn't
   sign webhooks). The webhook now **fails closed**: if this secret is unset every
   IPN is rejected and bookings never auto-confirm. The webhook also re-queries
   Mobbex server-side (`/p/operations/ref\<reference>`, same API creds) and checks
   the paid amount against the service price before confirming — so a forged IPN
   can't confirm a booking without a real payment.
4. `create-payment` builds the webhook URL automatically as
   `${SUPABASE_URL}/functions/v1/mobbex-webhook?token=…` — just make sure it's
   publicly reachable (tunnel locally; already public on cloud).
5. Test cards: see `mobbex.dev/medios-de-pago-para-pruebas`.

## 10. WhatsApp

- Set `NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER` (international, no `+`). This powers
  the `wa.me` links and is all v1 needs.
- *(Optional, Cloud API)* set `WHATSAPP_VERIFY_TOKEN` and register the Meta webhook
  at `${SUPABASE_URL}/functions/v1/whatsapp-webhook` (GET verify + POST messages).

## 11. Production deploy

**Supabase (free cloud project):**

```bash
pnpm dlx supabase link --project-ref <ref>
pnpm dlx supabase db push
pnpm dlx supabase functions deploy
pnpm dlx supabase secrets set \
  GOOGLE_SERVICE_ACCOUNT_JSON="$(cat key.json)" GOOGLE_CALENDAR_ID=... \
  MOBBEX_API_KEY=... MOBBEX_ACCESS_TOKEN=... MOBBEX_TEST=false \
  MOBBEX_WEBHOOK_SECRET=... APP_URL=https://tu-dominio WHATSAPP_VERIFY_TOKEN=... \
  RESEND_API_KEY=re_... EMAIL_FROM="VULL <hola@tu-dominio>"
```

**Frontend (Vercel):** import the repo and set `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (from the cloud project), `NEXT_PUBLIC_SITE_URL`
(prod domain), `NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER`, `NEXT_PUBLIC_TRANSFER_ALIAS`.

**keep-alive:** schedule a weekly GET to
`${SUPABASE_URL}/functions/v1/keep-alive` (cron-job.org or a GitHub Actions cron)
so the free project doesn't pause.

---

## Environment variable reference

| Variable | Scope | Where it comes from |
|----------|-------|---------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Frontend | `supabase status` (local) / project API settings (cloud) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Frontend | same as above |
| `NEXT_PUBLIC_SITE_URL` | Frontend | your site URL (`http://localhost:3000` in dev) |
| `NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER` | Frontend | business WhatsApp, intl format, no `+` |
| `NEXT_PUBLIC_TRANSFER_ALIAS` | Frontend | alias/CBU shown for manual transfer |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Edge Function | **injected automatically** by Supabase — don't set manually |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Edge Function | GCP service-account JSON key (step 8) |
| `GOOGLE_CALENDAR_ID` | Edge Function | Google Calendar → Integrate calendar |
| `MOBBEX_API_KEY` / `MOBBEX_ACCESS_TOKEN` | Edge Function | mobbex.dev dev portal |
| `MOBBEX_TEST` | Edge Function | `true` sandbox / `false` live |
| `MOBBEX_WEBHOOK_SECRET` | Edge Function | random string you choose — **required** (webhook fails closed without it) |
| `APP_URL` | Edge Function | site URL used for Mobbex `return_url` |
| `RESEND_API_KEY` | Edge Function + Auth SMTP | resend.com → API Keys (free tier, own domain) |
| `EMAIL_FROM` | Edge Function | sender on the Resend-verified domain, e.g. `VULL <hola@tu-dominio>` |
| `WHATSAPP_VERIFY_TOKEN` | Edge Function | Meta webhook verify token (GET handshake) |
| `WHATSAPP_APP_SECRET` | Edge Function | Meta App Secret — **required for the POST webhook** (verifies the `X-Hub-Signature-256` HMAC; fails closed without it) |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | Edge Function | Meta Cloud API (optional, fase 2) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Frontend | Web Push public key (`npx web-push generate-vapid-keys`) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Edge Function | Web Push VAPID keys + `mailto:` subject (admin push) |
| `BOOKING_HOLD_MINUTES` | Edge Function | minutes a pending booking holds a slot (default 10) |
| `MAX_ACTIVE_HOLDS` | Edge Function | max concurrent unconfirmed holds per user (default 3) |
| `BOOKING_THROTTLE_SECONDS` | Edge Function | min seconds between a user's bookings (default 5) |
| `CORS_EXTRA_ORIGINS` | Edge Function | extra browser origins allowed to call functions (comma-separated) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Frontend | Cloudflare Turnstile site key (optional, enables login captcha) |
| `TURNSTILE_SECRET` | Auth | Cloudflare Turnstile secret (with `[auth.captcha]`) |

> Working hours / days / timezone are **not** env vars — they're a row in the
> `settings` table (edit in Studio or via the admin panel).

## Security hardening

- **CORS** — Edge Functions echo back only allow-listed browser origins (`APP_URL`
  + `localhost` + any `CORS_EXTRA_ORIGINS`), not `*`. Add every host clients/admin
  use (apex **and** `www`, plus preview domains) to `CORS_EXTRA_ORIGINS` or
  browser calls from those hosts are blocked. Webhooks are server-to-server and
  send no CORS.
- **Booking anti-abuse** — a user can hold at most `MAX_ACTIVE_HOLDS` unconfirmed
  turnos at once and must wait `BOOKING_THROTTLE_SECONDS` between bookings (on top
  of the one-turno-per-day rule).
- **Bot protection (captcha)** — recommended before launch to stop email
  enumeration / OTP spam. Create a free **Cloudflare Turnstile** widget, then: (1)
  set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (browser) and `TURNSTILE_SECRET`
  (Edge/Auth); (2) uncomment `[auth.captcha]` in `supabase/config.toml` (provider
  `turnstile`, `secret = "env(TURNSTILE_SECRET)"`) and push config to the hosted
  project. The login form sends the token automatically once the site key is set;
  with no key, captcha is off and login is unchanged. The OTP resend cooldown is
  `60s` (`[auth.email] max_frequency`).

## Notifications (owner alerts)

The owner is alerted on actionable events (a transfer/pack receipt to verify, a
paid/credit booking confirmed, a client cancellation) via two channels, both
best-effort:

- **Email** — reuses Resend (`RESEND_API_KEY` + `EMAIL_FROM`). Works on any device,
  no setup beyond email. This is the always-available floor.
- **Web Push** — instant notification to the owner's device(s). `npx web-push
  generate-vapid-keys`, then set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (browser) +
  `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (Edge secrets). The owner
  enables it from **/admin** ("Activar notificaciones"). iOS requires the PWA be
  added to the home screen first (iOS 16.4+); email covers that gap. Validate
  against one real device before relying on it (the encryption can't be tested
  without a live subscription).

## Google Calendar sync-back (optional)

`calendar-poll` (cron-driven, own `?token=` secret, fail-closed) reconciles
external Google Calendar edits back to bookings: an event deleted/cancelled in
Calendar cancels the matching booking; a paid booking whose event was moved is
flagged to the owner (not silently moved); events with no matching booking are
ignored (they already show as busy via freeBusy). Drive it from the same external
cron as `keep-alive` (e.g. every 5 min). Needs `GOOGLE_*` configured +
`CALENDAR_POLL_TOKEN`.
