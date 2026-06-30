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
| `WHATSAPP_VERIFY_TOKEN` | Edge Function | Meta webhook verify token (optional) |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | Edge Function | Meta Cloud API (optional, fase 2) |
| `BOOKING_HOLD_MINUTES` | Edge Function | minutes a pending booking holds a slot (default 10) |

> Working hours / days / timezone are **not** env vars — they're a row in the
> `settings` table (edit in Studio or via the admin panel).
