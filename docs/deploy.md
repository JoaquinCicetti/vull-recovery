# Deploy

Three things ship separately, all **by hand**:

| Part | Where | How |
|------|-------|-----|
| Database schema | Supabase project (Postgres, `us-west-2`) | `pnpm exec supabase db push` |
| Edge functions | Supabase Edge Functions | `pnpm exec supabase functions deploy <name>` |
| Frontend | Cloudflare Worker `app`, on `www.vull.com.ar` | `scripts/deploy.sh [prod\|dev]` (`pnpm deploy` / `pnpm deploy:dev`) |

There is one site (`www.vull.com.ar`) and one Supabase project. There is no
staging or dev domain: "dev mode" is the same site switched to the Talo sandbox.

CI (`.github/workflows/ci.yml`) runs checks only. Its `deploy` job has been
disabled (`if: false && …`) since 2026-10-27, and nothing applies migrations
automatically.

---

## Prerequisites (once per machine)

```bash
pnpm install
pnpm exec supabase login
pnpm exec supabase link --project-ref <project-ref>
pnpm exec wrangler login
```

Gitignored files `scripts/deploy.sh` reads:

| File | Holds |
|------|-------|
| `.env.production` | Browser config. Only its `NEXT_PUBLIC_*` lines are used; `NEXT_PUBLIC_SITE_URL` must be the `https://` production URL. |
| `supabase/.env.prod` | Production Talo account: `TALO_USER_ID`, `TALO_CLIENT_ID`, `TALO_CLIENT_SECRET`, `TALO_TEST=false`, `DEV_MODE=false` |
| `supabase/.env.dev` | Talo **sandbox** account, same keys, `TALO_TEST=true`, `DEV_MODE=true` |

`NEXT_PUBLIC_*` values are inlined at build time. Only a build made by
`deploy.sh` gets the production values: a plain `pnpm build` uses whatever
`.env.local` holds, because Next lets `.env.local` override `.env.production`.

---

## The frontend: `scripts/deploy.sh`

```bash
scripts/deploy.sh            # prod mode (pnpm deploy)
scripts/deploy.sh dev        # dev mode  (pnpm deploy:dev)
```

What it does, in order:

1. **Browser config.** Exports the `NEXT_PUBLIC_*` lines of `.env.production`,
   sets `NEXT_PUBLIC_DEV_MODE` to the mode, and in dev mode forces
   `NEXT_PUBLIC_TALO_ENABLED=true`. Fails unless `NEXT_PUBLIC_SITE_URL` is https.
2. **Migrations check.** Reads `supabase_migrations.schema_migrations` from the
   linked project and **refuses to deploy** if any file in `supabase/migrations`
   is not applied.
3. **Mode secrets.** Pushes `supabase/.env.<mode>` to the project with
   `supabase secrets set`, after checking its `DEV_MODE` and `TALO_TEST` match
   the mode.
4. **Required secrets check.** Compares `supabase/.env.secrets.example` (names
   above `# @optional`) with `supabase secrets list` and warns about any missing
   one. It also warns if `EMAIL_SINK_URL` is set on the project.
5. **Edge functions**, only with `--functions`: `supabase functions deploy --use-api`
   (all of them), before the Worker.
6. **Worker.** `opennextjs-cloudflare build` then `opennextjs-cloudflare deploy`.

Flags:

| Flag | Effect |
|------|--------|
| `--strict` | Fail instead of warn when a required secret is missing or `EMAIL_SINK_URL` is set |
| `--functions` | Also deploy every edge function before the Worker |
| `SKIP_SECRETS=1` (env) | Don't push mode secrets; instead check the project's `DEV_MODE` already matches the mode |

**Production must be built in prod mode**, which keeps
`NEXT_PUBLIC_TALO_ENABLED=true` from `.env.production`. Talo is the only way to
pay: with it false, the pay button becomes a "write us on WhatsApp" line.

**Switching modes** swaps the Talo account behind the site. A payment still
pending when you switch belongs to the other account and won't settle until you
switch back, so don't switch with real payments open. Always finish with
`pnpm deploy`.

Worker details (`wrangler.jsonc`): custom domain route `www.vull.com.ar`,
`workers_dev` off, placement `aws:us-west-2` next to the database (ADR 0015),
Cloudflare Images binding for `next/image`. The apex `vull.com.ar` is redirected
to `www` by a zone rule and never reaches the Worker. Prerendered pages are
served from Workers static assets (`open-next.config.ts`) and only change on
deploy. The Worker needs no runtime secrets: the app only reads `NEXT_PUBLIC_*`.

---

## Database migrations

```bash
pnpm exec supabase migration list    # local vs remote: anything not applied?
pnpm exec supabase db push           # apply the pending ones
```

Check `migration list` first. Remote and local can drift; never assume the
project matches the repo. `deploy.sh` refuses to ship the Worker until every
migration is applied, so the site never runs ahead of the schema it reads.

## Edge functions

```bash
pnpm exec supabase functions deploy <name>       # one function
pnpm exec supabase functions deploy              # all of them
```

`verify_jwt` per function is in `supabase/config.toml`. Webhooks and crons
(`talo-webhook`, `talo-reconcile`, `notify-dispatch`, `membership-cycle`,
`calendar-poll`, `whatsapp-webhook`, `keep-alive`, `availability`,
`membership-availability`) run with it off and check their own `?token=` where
they have one.

**Which functions to redeploy.** A change in `supabase/functions/_shared/`
ships only with the functions that import it, directly or through another
shared module. Find them with:

```bash
cd supabase/functions
grep -lE '_shared/(notify|talo-settle)\.ts' */index.ts
```

For example, `_shared/notify-render.ts` and `_shared/email.ts` are imported by
`_shared/notify.ts`, so a change there needs: `admin-booking`,
`admin-membership`, `admin-payment`, `calendar-poll`, `cancel-booking`,
`create-booking`, `create-payment` (through `talo-settle.ts`),
`membership`, `membership-cycle`, `notify-dispatch`, `swap-booking`,
`talo-reconcile`, `talo-webhook`. When in doubt, deploy all of them.

### Edge secrets

The canonical list is `supabase/.env.secrets.example`: everything above
`# @optional` is required in production. `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` are injected by the platform. The Talo account keys,
`TALO_TEST` and `DEV_MODE` are pushed by `deploy.sh`; set the rest once:

```bash
pnpm exec supabase secrets set \
  APP_URL=https://www.vull.com.ar \
  RESEND_API_KEY=re_... EMAIL_FROM="VULL <sender@your-verified-domain>" \
  VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:... \
  TALO_WEBHOOK_SECRET="$(openssl rand -hex 24)" \
  TALO_RECONCILE_TOKEN="$(openssl rand -hex 24)" \
  NOTIFY_DISPATCH_TOKEN="$(openssl rand -hex 24)"
pnpm exec supabase secrets list      # names + digests, to check
```

Never set `EMAIL_SINK_URL` on the project. What each secret does:
[setup.md › Environment variable reference](setup.md#environment-variable-reference).

### Crons

Point an external scheduler (cron-job.org, a GitHub Actions schedule…) at:

| Endpoint | Every | Needed |
|----------|-------|--------|
| `POST ${SUPABASE_URL}/functions/v1/talo-reconcile?token=$TALO_RECONCILE_TOKEN` | ~10 min | Yes: guarantees a paid turno is confirmed even if a webhook is lost |
| `GET ${SUPABASE_URL}/functions/v1/keep-alive` | weekly | Yes: keeps the free project from pausing |
| `POST ${SUPABASE_URL}/functions/v1/notify-dispatch?token=$NOTIFY_DISPATCH_TOKEN` | ~5 min | Recommended: retries notices that failed or were cut short (ADR 0013) |
| `POST ${SUPABASE_URL}/functions/v1/membership-cycle?token=$MEMBERSHIP_CYCLE_TOKEN` | daily | Optional: abono housekeeping already runs lazily (ADR 0011) |

`calendar-poll` is a manual one-shot sync, not a cron.

---

## Release order

The order matters because each layer depends on the one before it:

1. **Migrations first.** Functions call RPCs and the frontend queries tables
   that migrations create. Example: the admin agenda's booking query embeds
   `session_surveys` and `sectors.survey_enabled` (ADR 0017), so the frontend
   errors on an older schema.
2. **Edge functions next**, so the new site never calls a function version it
   predates.
3. **Frontend last.**

## Release checklist

1. **Checks pass locally**: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`,
   and from `supabase/functions` `pnpm dlx deno@2 check */index.ts _shared/*.ts`
   and `pnpm dlx deno@2 test _shared/` (see [development.md](development.md)).
2. **Check drift**: `pnpm exec supabase migration list`. Note what is pending.
3. **Apply migrations**: `pnpm exec supabase db push`. Re-run `migration list`;
   local and remote must match.
4. **Secrets**: if the release adds an edge secret, set it
   (`supabase secrets set`) and add its name to `supabase/.env.secrets.example`.
5. **Deploy functions**: `pnpm exec supabase functions deploy <name>` for every
   changed function and every function importing a changed `_shared/` module
   (see above).
6. **Deploy the frontend**: `pnpm deploy` (prod mode). It re-checks migrations
   and secrets; read its warnings.
7. **Smoke test** the live site (below).

### Release: post-session surveys (ADR 0017, unreleased)

1. `pnpm exec supabase migration list`, then `pnpm exec supabase db push` to
   apply `20261112120000_session_surveys.sql` (tables, RPCs, the
   `survey_submitted` notification kind).
2. Redeploy every function that imports `_shared/notify.ts` (the list above),
   at least `notify-dispatch`: `notify-render.ts` and `email.ts` changed.
3. `pnpm deploy`.
4. Check: Agenda › Turnos › Pasados › a confirmed turno's `…` menu ›
   "Enviar encuesta por WhatsApp" opens
   WhatsApp with the link; answering at `/encuesta/<id>` notifies admins and
   shows in Métricas › Encuestas; plan pages show the stations as tags.

### Release: public reviews and survey export (ADR 0018, unreleased)

1. `pnpm exec supabase db push` to apply `20261117120000_survey_reviews.sql`
   (review columns, `submit_session_survey` replaced, `admin_set_review_status`,
   `public_reviews`). Until it is applied, Métricas › Encuestas and the survey
   dialog in Agenda error, because they select the new columns.
2. Redeploy `notify-dispatch` (`notify-render.ts` changed).
3. `pnpm deploy`.
4. Check: a past turno in Mis turnos shows "Completar encuesta"; a survey sent
   with stars and a comment appears in Métricas › Encuestas as "Por aprobar"
   and not on the home page; approving it shows it on the home page below the
   plans; "Exportar CSV" downloads the answers.

---

## After deploying: smoke test

1. `https://www.vull.com.ar` loads; the `cf-placement` response header on a
   dynamic page reads `remote-…` (ADR 0015).
2. Sign in with an email code (the email has a **code**, not a link).
3. Book a turno and pay with Talo; it confirms and both client and admins are
   notified.
4. `/admin` opens the agenda; Ajustes › "Avisos no enviados" is empty.

The fuller list is [runbooks/manual-testing.md § 9](runbooks/manual-testing.md#9-quick-smoke-test-after-every-deploy).
To test payments without real money, `pnpm deploy:dev` (sandbox + "Simular
pago"), then `pnpm deploy` again.

---

## One-time wiring (domain, Auth, email)

### Supabase Auth URLs

Dashboard → Authentication → URL Configuration, mirrored in
`supabase/config.toml` (`[auth]`):

- **Site URL**: `https://www.vull.com.ar`
- **Redirect URLs**: `https://www.vull.com.ar/**` and `http://localhost:3000/**`
  (local `pnpm dev` uses the same project)

Google sign-in redirects back to `/auth/callback` through these. Google Cloud
needs no change for a new domain: its redirect URI is the Supabase callback
(`https://<project-ref>.supabase.co/auth/v1/callback`).

### Email from your own domain (Resend)

Both the sign-in codes (Supabase Auth) and the notices (edge functions) go
through [Resend](https://resend.com). Free tier: 3,000 emails/month, 100/day,
one domain.

1. **Verify the domain**: Resend → Domains → Add Domain → add the DNS records it
   shows (SPF/DKIM TXT, DMARC, MX) and wait for **Verified**.
2. **Create an API key**: Resend → API Keys.
3. **Edge functions**: set `RESEND_API_KEY` and `EMAIL_FROM` (a sender on the
   verified domain) as secrets.
4. **Auth SMTP**: Dashboard → Authentication → Emails → SMTP: host
   `smtp.resend.com`, port `465`, user `resend`, password = the API key, sender
   on the verified domain, name `VULL`. The same values sit commented in
   `supabase/config.toml` under `[auth.email.smtp]`.
5. **Code-only templates and OTP length**: push `supabase/config.toml` (templates
   `magic_link` and `confirmation`, both `supabase/templates/magic_link.html`,
   `otp_length = 8`):
   ```bash
   pnpm exec supabase config push
   ```
   Re-run it whenever `[auth.*]` changes; nothing applies it automatically.

Without SMTP, hosted Auth falls back to Supabase's built-in mailer, limited to a
few emails per hour.

### CORS

Edge functions answer browser calls only from `APP_URL`, `localhost` and
`CORS_EXTRA_ORIGINS`. If clients reach the site on another host, add it there.

---

## Re-enabling the CI deploy (currently off)

The `deploy` job in `.github/workflows/ci.yml` runs
`SKIP_SECRETS=1 scripts/deploy.sh prod --functions` after the checks pass on a
push to `main`. To turn it back on, drop `false &&` from its `if`. It needs:

| Name | Kind | Value |
|------|------|-------|
| `SUPABASE_ACCESS_TOKEN` | secret | Supabase → Account → Access Tokens |
| `CLOUDFLARE_API_TOKEN` | secret | Cloudflare API token ("Edit Cloudflare Workers"), scoped to the account and the zone |
| `ENV_PRODUCTION` | secret | The `NEXT_PUBLIC_*` lines of `.env.production` |
| `SUPABASE_PROJECT_REF` | variable | The project ref |
| `CLOUDFLARE_ACCOUNT_ID` | variable | Cloudflare dashboard → Account ID |

It still never runs `db push`: it refuses when a migration is pending.
