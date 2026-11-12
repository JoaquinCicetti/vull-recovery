# Setup, step by step

From a fresh clone to a working site: the app, the Supabase project, then each
integration. Commands run from the project root with **pnpm**.

There is **no local Supabase stack**. The app always talks to the cloud
project, in development too. Deploying is covered in [deploy.md](deploy.md);
the daily workflow in [development.md](development.md).

---

## 0. Prerequisites

- **Node 22** and **pnpm** (`corepack enable pnpm`). CI uses Node 22 and pnpm 11.
- Access to the Supabase project and the Cloudflare account (for deploys).
- Deno is **not** needed on your PATH: it runs through `pnpm dlx deno@2`.

## 1. Install

```bash
pnpm install
```

This also installs the Supabase CLI (`pnpm exec supabase`) and Wrangler
(`pnpm exec wrangler`) as dev dependencies.

## 2. Link the Supabase project

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref <project-ref>
```

For a brand-new project, create one first (free tier) in the Supabase
dashboard, then apply the schema:

```bash
pnpm exec supabase migration list    # what is applied vs. what is in the repo
pnpm exec supabase db push           # apply supabase/migrations/*
pnpm exec supabase config push       # Auth settings + code-only email template
```

## 3. Frontend env: `.env.local`

```bash
cp .env.example .env.local
```

The minimum for `pnpm dev`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # Settings → API Keys
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_TALO_ENABLED=true     # shows the pay button
```

Only `NEXT_PUBLIC_*` variables reach the app; everything else in `.env.example`
is an edge-function secret, listed there for reference. Every variable is in the
[reference table](#environment-variable-reference) below.

## 4. Run

```bash
pnpm dev     # http://localhost:3000
```

Sign in with a real email: the code arrives by email (through Resend once
step 6 is done). `http://localhost:3000/**` is already an allowed Auth redirect
(`supabase/config.toml`).

## 5. Make yourself admin

Sign in once, then in the dashboard's SQL editor (or
`pnpm exec supabase db query --linked "…"`):

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'you@example.com');
```

`/admin` (Agenda, Clientes, Métricas, Ajustes) unlocks. In **Ajustes**, set up
each sector (Recovery, Pilates): opening hours and slot length, booking window,
active beds/places, and the plans. Opening hours are not env vars (see the note
under the reference table).

## 6. Edge-function secrets

Edge functions run on the cloud project and read their config from Supabase
secrets. The canonical list, with comments, is
`supabase/.env.secrets.example`; everything above `# @optional` is required in
production.

```bash
pnpm exec supabase secrets set KEY=value ...
pnpm exec supabase secrets list
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
by the platform; don't set them. The Talo account keys, `TALO_TEST` and
`DEV_MODE` are pushed by `scripts/deploy.sh` from `supabase/.env.prod` or
`supabase/.env.dev` (see [deploy.md](deploy.md)). Deploy the functions with
`pnpm exec supabase functions deploy`.

## 7. Email (Resend)

1. Verify the sending domain in Resend and create an API key
   (details: [deploy.md › Email](deploy.md#email-from-your-own-domain-resend)).
2. Edge secrets: `RESEND_API_KEY`, `EMAIL_FROM` (a sender on the verified
   domain, e.g. `VULL <sender@your-domain>`).
3. Auth SMTP in the dashboard, so sign-in codes go through Resend too.

Without the edge secrets every notice fails and is listed in Ajustes ›
"Avisos no enviados". `EMAIL_SINK_URL` exists in `_shared/email.ts` to divert
mail to a test inbox; **never** set it on the project (`deploy.sh` warns if it
is).

## 8. Talo (automatic bank transfers)

Talo is the only way to pay ([ADR 0010](adr/0010-payments-talo-transfers.md),
[0014](adr/0014-no-manual-confirmation-admin-slot-blocks.md),
[0016](adr/0016-coupons-and-talo-hosted-page.md)). `create-payment` mints a
one-time CVU/alias per payment and sends the client to Talo's hosted page;
`talo-webhook` re-fetches the payment from Talo, checks the amount received and
confirms the turno, pack or cuota. `talo-reconcile` re-checks anything still
unsettled. There is no receipt upload and no manual "mark paid"; cash at the
desk is an admin slot block (Agenda › Bloquear horario).

1. Accounts: a **sandbox** account at `sandbox.talo.com.ar` (separate from
   production) and the production account. In each: Dashboard → Usuario →
   Credenciales → `user_id`, `client_id`, `client_secret`.
2. Put them in the gitignored mode files `scripts/deploy.sh` reads:
   - `supabase/.env.prod`: production keys, `TALO_TEST=false`, `DEV_MODE=false`
   - `supabase/.env.dev`: sandbox keys, `TALO_TEST=true`, `DEV_MODE=true`
3. Our own tokens, set once:
   ```bash
   pnpm exec supabase secrets set \
     TALO_WEBHOOK_SECRET="$(openssl rand -hex 24)" \
     TALO_RECONCILE_TOKEN="$(openssl rand -hex 24)"
   ```
   `TALO_WEBHOOK_SECRET` is **required**: `talo-webhook` fails closed without
   it. Talo doesn't sign webhooks, and every payment is re-fetched from Talo
   before anything is confirmed, so the token only gates who may trigger a
   check. `create-payment` builds the webhook URL
   (`${SUPABASE_URL}/functions/v1/talo-webhook?token=…`) itself.
4. Optional: `TALO_PAYMENT_MINUTES` (default 30), how long the client has to
   transfer. It is also how long the slot stays held.
5. Schedule `talo-reconcile` every ~10 min ([deploy.md › Crons](deploy.md#crons)).
6. `NEXT_PUBLIC_TALO_ENABLED=true` in `.env.production` (and `.env.local` to pay
   locally). With it false the pay button becomes a "write us on WhatsApp" line.

**Sandbox run.** `pnpm deploy:dev` switches the site and the functions to the
sandbox account and shows **"Simular pago"** on the payment screen
(`dev-fake-payment`, which asks Talo's sandbox faucet to send the money; the
real webhook then confirms). Things to check:

1. Book a turno and pay: one `payments` row (`provider='talo'`,
   `status='pending'`, `talo_payment_id` set); the booking stays `pending` with
   `hold_expires_at` at the CVU's expiry.
2. "Simular pago" → payment `approved`, booking `confirmed`, client and admin
   notified.
3. Underpay → stays `pending`, flagged *pagó de menos* at the top of the
   Agenda. Overpay → `approved` and flagged *pagó de más*.
4. Two concurrent clicks on pay → one row, one CVU.
5. Replaying the same webhook, or running `talo-reconcile` → still one
   confirmation, one notice.
6. Webhook without `?token=` → 401.
7. Cancel a booking with a live CVU → the CVU is expired at Talo.

Then `pnpm deploy` to go back to production. A payment started in one mode
won't settle in the other.

## 9. Web push (VAPID)

```bash
npx web-push generate-vapid-keys
```

- Browser: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (in `.env.production` / `.env.local`).
- Edge secrets: `VAPID_PUBLIC_KEY` (the same public key), `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT` (`mailto:` address).

The browser key and the edge key must be the same pair. Admins turn push on per
device in Ajustes ("Activar notificaciones en este dispositivo"); clients on
`/cuenta/notificaciones`. iOS needs the installed app (16.4+).

## 10. Google Calendar (optional)

Recovery availability subtracts the calendar's busy blocks, and bookings create
events. Without it, availability comes from the database only.

1. Google Cloud Console → a project → enable the **Google Calendar API**.
2. Create a **service account** and a **JSON key**.
3. Share the centre's calendar with the service account's email ("Make changes
   to events").
4. Calendar settings → Integrate calendar → copy the **Calendar ID**.
5. Edge secrets, from the key JSON:
   ```bash
   pnpm exec supabase secrets set GOOGLE_CLIENT_EMAIL=... \
     GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" \
     GOOGLE_CALENDAR_ID=...
   ```

**Sync-back (manual).** `calendar-poll` applies Google edits back to bookings:
an event deleted in Calendar cancels its booking; a paid booking whose event was
moved is flagged, not moved. It is not scheduled; run it when needed with
`POST ${SUPABASE_URL}/functions/v1/calendar-poll?token=$CALENDAR_POLL_TOKEN`
(set `CALENDAR_POLL_TOKEN` first; it fails closed).

## 11. WhatsApp

- `wa.me` links (booking confirmations, survey links) use
  `NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER` (international, no `+`). Unset, it
  falls back to the public number in `lib/site.ts`.
- Optional inbound webhook (`whatsapp-webhook`, Meta Cloud API): set
  `WHATSAPP_VERIFY_TOKEN` (GET handshake) and `WHATSAPP_APP_SECRET` (verifies
  `X-Hub-Signature-256` on POST; fails closed), and register
  `${SUPABASE_URL}/functions/v1/whatsapp-webhook` with Meta.

## 12. Bot protection (optional)

Cloudflare Turnstile on the login form: set `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
(browser) and `TURNSTILE_SECRET`, uncomment `[auth.captcha]` in
`supabase/config.toml` (provider `turnstile`, `secret = "env(TURNSTILE_SECRET)"`)
and run `pnpm exec supabase config push`. With no site key, captcha stays off.

## 13. Crons

`talo-reconcile` (~10 min), `keep-alive` (weekly), and optionally
`notify-dispatch` (~5 min) and `membership-cycle` (daily). Endpoints and tokens:
[deploy.md › Crons](deploy.md#crons).

---

## Environment variable reference

**Browser** (`NEXT_PUBLIC_*`, inlined at build time; production values live in
`.env.production`):

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Publishable key (`sb_publishable_…`) |
| `NEXT_PUBLIC_SITE_URL` | yes | Site origin: Auth redirects, canonical/OG URLs. `http://localhost:3000` locally, the `https://` www URL in production |
| `NEXT_PUBLIC_TALO_ENABLED` | yes in prod | `true` shows the pay button; Talo is the only way to pay |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | for push | Web push public key |
| `NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER` | no | Overrides the `wa.me` number in `lib/site.ts` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | no | Turns on the login captcha |
| `NEXT_PUBLIC_DEV_MODE` | no | Set by `deploy.sh`: DEV badge + "Simular pago". Never `true` in production |
| `NEXT_PUBLIC_BLUR_TEXT` | no | Demo only: blurs all text |

**Edge-function secrets** (`supabase secrets set`; canonical list in
`supabase/.env.secrets.example`):

| Secret | Required | Purpose |
|--------|----------|---------|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | injected | Set by the platform |
| `APP_URL` | yes | Site URL: Talo redirect, links in emails, CORS allow-list |
| `RESEND_API_KEY` / `EMAIL_FROM` | yes | Email via Resend |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | yes | Web push |
| `TALO_USER_ID` / `TALO_CLIENT_ID` / `TALO_CLIENT_SECRET` | yes | Talo API credentials (pushed by `deploy.sh`) |
| `TALO_TEST` | yes | `true` → Talo sandbox. Must match the deploy mode (pushed by `deploy.sh`) |
| `TALO_WEBHOOK_SECRET` | yes | `?token=` of the Talo webhook URL |
| `TALO_RECONCILE_TOKEN` | yes | Gates the `talo-reconcile` cron |
| `NOTIFY_DISPATCH_TOKEN` | no | Gates the `notify-dispatch` cron |
| `MEMBERSHIP_CYCLE_TOKEN` | no | Gates `membership-cycle` |
| `DEV_MODE` | no | `true` enables `dev-fake-payment` (also needs `TALO_TEST=true`); pushed by `deploy.sh` |
| `TALO_PAYMENT_MINUTES` | no | Minutes to transfer, also the slot hold (default 30) |
| `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` / `GOOGLE_CALENDAR_ID` | no | Google Calendar availability and events |
| `CALENDAR_POLL_TOKEN` | no | Gates `calendar-poll` |
| `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_APP_SECRET` | no | Inbound WhatsApp webhook |
| `CORS_EXTRA_ORIGINS` | no | Extra browser origins allowed to call the functions (comma-separated) |
| `MAX_ACTIVE_HOLDS` | no | Max unconfirmed holds per user (default 3) |
| `BOOKING_THROTTLE_SECONDS` | no | Min seconds between a user's bookings (default 5) |
| `EMAIL_SINK_URL` | never deployed | Diverts mail to a test sink; `deploy.sh` warns if set |

**Auth** (`supabase/config.toml`, `env(...)`): `TURNSTILE_SECRET` for the
captcha, and the Resend API key as the SMTP password (set in the dashboard).

> **Not env vars:** each sector's opening hours (`sector_hours`, several ranges
> per weekday, each with its `slot_minutes`), the booking window
> (`sectors.booking_window`), the slot hold (`sectors.hold_minutes`), the number
> of simultaneous turnos (active `resources`) and the abono billing policy (due
> day, late fee, release day) live in the database and are edited in Ajustes.
> See [ADR 0012](adr/0012-admin-defined-slots-and-booking-window.md).

---

## Security hardening

- **CORS.** Edge functions echo back only allow-listed origins (`APP_URL`,
  `localhost`, `CORS_EXTRA_ORIGINS`), never `*`. Webhooks are server-to-server
  and need none.
- **Booking anti-abuse.** At most `MAX_ACTIVE_HOLDS` unconfirmed turnos per user,
  `BOOKING_THROTTLE_SECONDS` between bookings, on top of one turno per day.
- **Captcha.** Turnstile (step 12) stops email enumeration and code spam. The
  code resend cooldown is 60 s (`[auth.email] max_frequency`).

## Notifications

Every notice is a row in the `notifications` outbox, written by the same
transaction that caused it and sent by one dispatcher
(`supabase/functions/_shared/notify.ts`). Decision record:
[ADR 0013](adr/0013-notification-outbox.md).

**Who hears what.** An admin's own action never notifies the other admins, only
the client.

| Event | Client | Admins |
|-------|--------|--------|
| Turno booked, payment pending | "Reserva tomada" (email only) | — |
| Turno paid (Talo), incl. pay-at-booking | "Turno confirmado" | "Nuevo turno pagado" (one notice for pay + book) |
| Turno booked with a pack credit | "Turno confirmado" | "X usó 1 sesión de su pack (quedan N)" |
| Admin resolves a flagged payment / cash cuota at the desk | confirmation | — |
| Pack paid (Talo) | "Sesiones acreditadas" | "Pack vendido" |
| Cuota paid (Talo) | "Abono confirmado" | "Nuevo abono" (first cuota) / "Cuota pagada" |
| Client cancels | "Turno cancelado" | "Turno cancelado por el cliente" |
| Admin / Google Calendar cancels | "Turno cancelado" (**critical**) | — |
| Admin reschedules | "Turno reprogramado" (**critical**) | — |
| Client moves or swaps a class | swap: offer + answer to the members | "Clase movida" |
| Client stops renewing an abono | — | "Abono sin renovación" |
| Admin releases an abono / sells one at the desk | "Liberamos tu lugar" / "Tu lugar está reservado" (email even with email off) | — |
| Client answers a post-session survey | — | survey notice; the push opens Métricas › Encuestas (ADR 0017) |
| Talo anomalies, calendar conflicts, abono roll collisions | — | alert, once per payment+flag / booking+time / member+month |

The `payment_to_verify` and `payment_rejected` kinds still exist for legacy
receipt rows from before ADR 0014; nothing new emits them from the app.

**Channels.** Clients choose email and/or push on `/cuenta/notificaciones`; at
least one stays on (`profiles_one_channel`). Push turns on only after the
device subscribed: the browser must support it, an iPhone/iPad must run the
installed app, and permission must be granted; otherwise the reason is shown. A
**critical** notice that reaches nobody (email off, no device took the push)
goes by email anyway, recorded as `channels.fallback = "email"`. Admins get
email + push on every subscribed device.

**Delivery.** The function that queued a notice sends it right after its
response (`kick`; the Talo webhook too, so Talo never waits); crons send before
answering. The `notify-dispatch` cron sends whatever is left. A row that fails
keeps its `error`, is retried up to 5 times, and is listed in Ajustes ›
**Avisos no enviados** with a "Reintentar" button. Every failure is logged with
the `[notify]` prefix in the function logs.

### Verifying notifications

In dev mode (`pnpm deploy:dev`), after each step run:

```bash
pnpm exec supabase db query --linked "select kind, audience, actor, sent_at, error, channels from notifications order by created_at desc limit 10"
```

1. **Single turno.** Book and "Simular pago": one `booking_confirmed` for the
   client and one for admins; nothing separate for the payment.
2. **Pack + credit bookings.** Buy a pack: `pack_purchased` client + admins.
   Book twice with credits: each admin row reads "usó 1 sesión… (quedan N)".
3. **Client cancel vs admin cancel.** Client cancels: `booking_cancelled` client
   + admins. Admin cancels: client only.
4. **Admin reschedule.** `booking_rescheduled`, client only.
5. **Abono cuota.** Pay via Talo: `membership_paid` client + admins. Cash cuota
   from the panel: client only.
6. **Survey.** Answer a survey: `survey_submitted`, admins.
7. **Replay.** Re-run `talo-reconcile` for a paid payment: still one row per
   (kind, subject, audience).

Finish with `pnpm deploy`.
