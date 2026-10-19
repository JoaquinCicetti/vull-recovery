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
/ Talo / email / WhatsApp, put them in `supabase/functions/.env` and serve
functions with that file. Every edge secret, by name, is in
`supabase/.env.secrets.example`:

```bash
# supabase/functions/.env  (SUPABASE_URL/keys are injected automatically)
GOOGLE_CLIENT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_CALENDAR_ID=
APP_URL=http://localhost:3000
NOTIFY_DISPATCH_TOKEN=some-random-string
WHATSAPP_VERIFY_TOKEN=
```

```bash
pnpm dlx supabase functions serve --env-file supabase/functions/.env
```

> Webhooks (Talo/WhatsApp) need a **public URL**. Locally, expose the functions
> port with a tunnel (e.g. `ngrok http 54321`) and point the provider at the
> tunneled `…/functions/v1/<name>` URL.

**Transactional email locally (dev only).** Booking emails go through Resend;
without `RESEND_API_KEY`/`EMAIL_FROM` each one fails and is listed on /admin
("Avisos no enviados"). To see them instead, add
`EMAIL_SINK_URL=http://host.docker.internal:54324/api/v1/send` to
`supabase/functions/.env`: `sendMail()` then posts every email to Mailpit's send
API instead of Resend (no API key needed) and it shows up at
http://127.0.0.1:54324 next to the OTP mail. Never set `EMAIL_SINK_URL` as a
deployed secret.

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
> days, slot length and timezone live per sector (Admin → Disponibilidad; see
> the note under the env var table).

## 9. Talo (automatic bank transfers)

Talo mints a one-time CVU/alias per payment and notifies us when the transfer
lands; the booking then confirms itself. See ADR 0010 for the design and the
list of assumptions the sandbox run below resolves.

1. Create a **sandbox** account at `sandbox.talo.com.ar` (it is separate from a
   production account) → Dashboard → Usuario → Credenciales → `user_id`,
   `client_id`, `client_secret`.
2. Set the Edge Function secrets:
   ```bash
   pnpm exec supabase secrets set TALO_USER_ID=... TALO_CLIENT_ID=... TALO_CLIENT_SECRET=... \
     TALO_WEBHOOK_SECRET="$(openssl rand -hex 24)" TALO_RECONCILE_TOKEN="$(openssl rand -hex 24)" \
     TALO_TEST=true TALO_PAYMENT_MINUTES=30
   ```
   `TALO_WEBHOOK_SECRET` is **required** — `talo-webhook` fails closed without it.
   Talo does not sign webhooks; every payment is re-fetched from Talo's API before
   anything is confirmed, so this token only rate-limits who may trigger a check.
3. Deploy `talo-webhook` and `talo-reconcile` (both `verify_jwt = false`, gated by
   their own tokens). `create-payment` builds the webhook URL automatically as
   `${SUPABASE_URL}/functions/v1/talo-webhook?token=…`, which must be publicly
   reachable — deploy to the cloud project rather than running it locally.
4. Point an external cron (cron-job.org, GitHub Actions…) at
   `POST ${SUPABASE_URL}/functions/v1/talo-reconcile?token=$TALO_RECONCILE_TOKEN`
   every ~10 minutes. The webhook's retry policy is undocumented; this sweep is
   what guarantees a paid turno is eventually confirmed.
5. Flip `NEXT_PUBLIC_TALO_ENABLED=true` and run the sandbox checklist:
   1. Book a turno, choose *Pagar por transferencia*. One `payments` row,
      `provider='talo'`, `status='pending'`, `talo_payment_id`/`talo_cvu` set;
      booking still `pending` with `hold_expires_at` ≈ now + 30 min.
   2. Get a token (`POST /users/{user_id}/tokens`) and simulate the transfer:
      `curl -X POST https://sandbox-api.talo.com.ar/cvu/<CVU>/faucet -H "Authorization: Bearer TL-…" -d '{"amount": <exact price>}'`
      → payment `approved`, booking `confirmed`, confirmation email, admin alert.
   3. Underpay (`price − 1`) → stays `pending`, flagged *pagó de menos*, visible in
      `/admin`. **Note the field that carried the received amount** — it confirms
      `parseReceived` in `_shared/talo.ts`.
   4. Overpay → `approved` + flagged *pagó de más*.
   5. **Expiry gate:** create, `PUT /payments/{id}/expiration` to now + 60 s, wait,
      then faucet. Whether the transfer bounces or credits decides whether the
      `EXPIRED → rejected` branch may stay as written (ADR 0010, assumption 4).
   6. Two concurrent *Pagar* clicks → one row, one CVU, both responses identical.
   7. Re-POST the same webhook body five times → one email, one credit-ledger row.
   8. Webhook without `?token=` → 401; with a bogus `paymentId` → 200 and no writes.
   9. Cancel a booking that has a live CVU → the CVU is expired at Talo.
   10. Stop the webhook (bad URL), faucet, invoke `talo-reconcile` → same end state.
6. For production: repeat with a production account, `TALO_TEST=false`, and a
   fresh `TALO_WEBHOOK_SECRET`.

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
# Every name in supabase/.env.secrets.example above "@optional":
pnpm dlx supabase secrets set \
  APP_URL=https://tu-dominio RESEND_API_KEY=re_... EMAIL_FROM="VULL <hola@tu-dominio>" \
  VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:... \
  TALO_WEBHOOK_SECRET=... TALO_RECONCILE_TOKEN=... MEMBERSHIP_CYCLE_TOKEN=... \
  NOTIFY_DISPATCH_TOKEN=...
```

`scripts/deploy.sh` warns about any required secret missing from the project
(`--strict` makes it fail).

**Frontend (Vercel):** import the repo and set `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (from the cloud project), `NEXT_PUBLIC_SITE_URL`
(prod domain), `NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER`, `NEXT_PUBLIC_TRANSFER_ALIAS`.

**keep-alive:** schedule a weekly GET to
`${SUPABASE_URL}/functions/v1/keep-alive` (cron-job.org or a GitHub Actions cron)
so the free project doesn't pause.

**Abonos need no cron.** The monthly roll, the late surcharge and the bed
release are derived from today's date at query time, and every booking/abono
function runs the same housekeeping lazily (ADR 0011). `membership-cycle` is
only a manual kick (`?token=MEMBERSHIP_CYCLE_TOKEN`) if you ever want to force
it.

**notify-dispatch (optional):** notifications are sent immediately by the
function that emits them. A cron every ~5 min at
`POST ${SUPABASE_URL}/functions/v1/notify-dispatch?token=$NOTIFY_DISPATCH_TOKEN`
only retries what failed or was lost (see [Notifications](#notifications) and
ADR 0013). Without it, failed rows wait on /admin "Avisos no enviados" for a
"Reintentar" (same function, admin session instead of the token).

**External crons, all together:** `keep-alive` weekly, `talo-reconcile` every
~10 min; optionally `notify-dispatch` every 5 min.

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
| `APP_URL` | Edge Function | site URL: Talo redirect, links in emails, CORS |
| `RESEND_API_KEY` | Edge Function + Auth SMTP | resend.com → API Keys (free tier, own domain) |
| `EMAIL_FROM` | Edge Function | sender on the Resend-verified domain, e.g. `VULL <hola@tu-dominio>` |
| `WHATSAPP_VERIFY_TOKEN` | Edge Function | Meta webhook verify token (GET handshake) |
| `WHATSAPP_APP_SECRET` | Edge Function | Meta App Secret — **required for the POST webhook** (verifies the `X-Hub-Signature-256` HMAC; fails closed without it) |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | Edge Function | Meta Cloud API (optional, fase 2) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Frontend | Web Push public key (`npx web-push generate-vapid-keys`) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Edge Function | Web Push VAPID keys + `mailto:` subject (admin push) |
| `MAX_ACTIVE_HOLDS` | Edge Function | max concurrent unconfirmed holds per user (default 3) |
| `BOOKING_THROTTLE_SECONDS` | Edge Function | min seconds between a user's bookings (default 5) |
| `CORS_EXTRA_ORIGINS` | Edge Function | extra browser origins allowed to call functions (comma-separated) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Frontend | Cloudflare Turnstile site key (optional, enables login captcha) |
| `TURNSTILE_SECRET` | Auth | Cloudflare Turnstile secret (with `[auth.captcha]`) |
| `MEMBERSHIP_CYCLE_TOKEN` | Edge Function | random string; gates the `membership-cycle` cron (fails closed) |
| `NOTIFY_DISPATCH_TOKEN` | Edge Function | random string; gates the `notify-dispatch` cron (fails closed) |
| `CALENDAR_POLL_TOKEN` | Edge Function | random string; gates the `calendar-poll` cron (fails closed) |
| `EMAIL_SINK_URL` | Edge Function (local only) | Mailpit send API; **never** a deployed secret |

The full list of edge secrets, by name, is `supabase/.env.secrets.example`.

> Opening hours are **not** env vars: each sector has per-weekday ranges in the
> `sector_hours` table, edited in Admin → Disponibilidad. Each range has its
> turno length (`slot_minutes`, "Turnos de 30 min"), and a turno takes one slot;
> a plan's duration is only shown to the client. How far ahead clients book
> (`sectors.booking_window`: this Mon–Sun week, or the next N days) and the
> number of simultaneous turnos (active `resources`) are edited there too. The
> abono billing policy (due day, late fee, release day) lives on the `sectors`
> row. See ADR 0012.

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

## Notifications

Every notice is a row in the `notifications` outbox, written by the same
transaction that caused it, and sent by one dispatcher
(`supabase/functions/_shared/notify.ts`). Decision record:
[ADR 0013](adr/0013-notification-outbox.md).

**Who hears what.** An admin's own action never notifies the other admins,
only the client.

| Event | Client | Admins |
|-------|--------|--------|
| Turno booked, payment pending | "Reserva tomada" (email only) | — |
| Turno paid (Talo), incl. pay-at-booking | "Turno confirmado" | "Nuevo turno pagado" (one notice for pay + book) |
| Turno booked with a pack credit | "Turno confirmado" | "X usó 1 sesión de su pack (quedan N)" |
| Receipt uploaded (turno, pack, cuota) | — | "… por verificar" |
| Admin approves a receipt / confirms by hand / cash cuota | confirmation | — |
| Admin rejects a receipt | "Comprobante rechazado" | — |
| Pack paid (Talo) | "Sesiones acreditadas" | "Pack vendido" |
| Cuota paid (Talo) | "Abono confirmado" | "Nuevo abono" (first cuota) / "Cuota pagada" |
| Client cancels | "Turno cancelado" | "Turno cancelado por el cliente" |
| Admin / Google Calendar cancels | "Turno cancelado" (**critical**) | — |
| Admin reschedules | "Turno reprogramado" (**critical**) | — |
| Client moves or swaps a class | swap: offer + answer to the members | "Clase movida" |
| Client stops renewing an abono | — | "Abono sin renovación" |
| Admin releases an abono / sells one at the desk | "Liberamos tu lugar" / "Tu lugar está reservado" (email even with email off) | — |
| Talo anomalies, calendar conflicts, abono roll collisions | — | alert, once per payment+flag / booking+time / member+month |

**Channels.** Clients choose email and/or push on /cuenta/notificaciones; at
least one stays on (`profiles_one_channel`). Push turns on only after this
device subscribed: the browser must support it (service worker, PushManager,
Notification), an iPhone/iPad must run the installed app, and permission must
be granted; otherwise the reason is shown and push stays off. A **critical**
notice (the centre cancelled or moved the turno) that reaches nobody, because
email is off and no device took the push, goes by email anyway, recorded as
`channels.fallback = "email"`. Admins get email + push on every device, no
preferences.

- **Email**: Resend (`RESEND_API_KEY` + `EMAIL_FROM`).
- **Web Push**: `npx web-push generate-vapid-keys`, then set
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (browser) + `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/
  `VAPID_SUBJECT` (Edge secrets). The owner enables it from **/admin** ("Activar
  notificaciones"); iOS 16.4+ requires the installed PWA. Validate against one
  real device before relying on it (the encryption can't be tested without a
  live subscription).

**Delivery.** The function that queued a notice sends it right after its
response (`kick`, the Talo webhook included: Talo must not wait); crons send
before answering. The
`notify-dispatch` cron (every 5 min) sends whatever is left. A row that fails
(e.g. Resend rejects `EMAIL_FROM`) keeps its `error`, is retried up to 5 times,
and is listed on **/admin → Avisos no enviados** with a "Reintentar" button.
Every failure is also logged with the `[notify]` prefix in the function logs.

### Verifying notifications locally

With the local stack running, the migration applied, functions served with
`EMAIL_SINK_URL` (mail lands in Mailpit, :54324) and Talo sandbox + `DEV_MODE`.
After each step, `select kind, audience, actor, sent_at, error, channels from
notifications order by created_at desc;` shows what was queued and sent.

1. **Single turno, Talo.** Book, pay with "Simular pago". One `booking_confirmed`
   for the user and ONE for admins ("reservó y pagó"); nothing for the payment
   itself. The client email has the briefing (recovery).
2. **Receipt.** Book, upload a receipt: one `payment_to_verify` (admins).
   Approve it from /admin: `booking_confirmed` user only (actor `admin`).
   Repeat and reject instead: `payment_rejected` to the client.
3. **Pack + 2 credit bookings.** Buy a pack via Talo: `pack_purchased` user +
   admins. Book twice with credits: each a `booking_confirmed` admins row that
   reads "usó 1 sesión de su pack (quedan N)" with N going down.
4. **Client cancel vs admin cancel.** Client cancels: `booking_cancelled` user +
   admins. Admin cancels another: user only. Then set that client to
   `notify_email = false, notify_push = true` in SQL with no `push_subscriptions`
   row, and cancel again as admin: the email still goes out, with
   `channels.fallback = "email"`.
5. **Admin reschedule.** `booking_rescheduled` user only, "Antes / Ahora" rows.
6. **Abono cuota, Talo vs desk.** Sign up and pay via Talo: `membership_paid`
   user + admins ("Nuevo abono"). Mark next month paid in cash from /admin:
   user only.
7. **Failure path.** Serve functions with a bad `EMAIL_FROM` (and no sink):
   the row gets `error`, appears on /admin "Avisos no enviados". Fix the env,
   press "Reintentar": it goes out and leaves the list.
8. **Replay.** Call `talo-webhook` five times for the same paid payment (and run
   `talo-reconcile`): still exactly one row per (kind, subject, audience).

## Google Calendar sync-back (optional)

`calendar-poll` (own `?token=` secret, fail-closed) is a one-shot sync of
external Google Calendar edits back to bookings: an event deleted/cancelled in
Calendar cancels the matching booking; a paid booking whose event was moved is
flagged to the owner (not silently moved); events with no matching booking are
ignored (they already show as busy via freeBusy). The calendar is not edited by
hand in practice, so it is not scheduled: run it manually when needed
(`POST …/functions/v1/calendar-poll?token=$CALENDAR_POLL_TOKEN`). Needs
`GOOGLE_*` configured + `CALENDAR_POLL_TOKEN`.
