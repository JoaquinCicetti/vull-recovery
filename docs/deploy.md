# Deploying VULL to your domain

> **This is not a static site.** It uses server-side auth (`requireUser`/`requireAdmin`),
> SSR data fetching, an OAuth callback route, and Supabase session cookies. A static
> export (`next export`) would break login and the admin/booking flow. Deploy it to a
> **Node/serverless host** — Vercel (recommended) or any Node server.
>
> The **frontend** (this Next.js app) and the **Edge Functions** (`supabase/functions/*`)
> deploy to *different* places: the app → Vercel, the functions → Supabase
> (`supabase functions deploy`). They talk over HTTPS.

---

## Option A — Vercel (recommended)

### 1. Push the repo to GitHub
Vercel deploys from a Git repo. If this isn't a repo yet:
```bash
git init && git add -A && git commit -m "Initial"
gh repo create vull-lab --private --source=. --push   # or create on github.com and push
```

### 2. Import into Vercel
- Go to [vercel.com/new](https://vercel.com/new) → import the repo.
- Framework preset: **Next.js** (auto-detected). Build command `next build`, output handled automatically.
- Package manager: **pnpm** (auto-detected from `pnpm-lock.yaml`).

### 3. Set environment variables (Vercel → Project → Settings → Environment Variables)
Only the **public** app vars are needed here — the app never uses the Supabase service
role (that lives in the Edge Functions).

| Variable | Value | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://wjdiojyelthaumuzkfxt.supabase.co` | ✅ |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | ✅ |
| `NEXT_PUBLIC_SITE_URL` | `https://your-domain.com` | ✅ |
| `NEXT_PUBLIC_TRANSFER_ALIAS` | bank alias/CBU | optional |
| `NEXT_PUBLIC_WHATSAPP_BUSINESS_NUMBER` | intl number, no `+` | optional |
| `NEXT_PUBLIC_BLUR_TEXT` | `false` | optional |

Deploy. You'll get a `*.vercel.app` URL — verify it loads before wiring the domain.

### 4. Add your custom domain
- Vercel → Project → **Settings → Domains** → add `your-domain.com` (and `www`).
- Vercel shows the DNS records to add at your registrar:
  - Apex (`your-domain.com`): an **A record** to Vercel's IP, or use Vercel nameservers.
  - `www`: a **CNAME** to `cname.vercel-dns.com`.
- Wait for DNS to propagate; Vercel issues the TLS cert automatically.

### 5. Point the app's public URL at the domain
Update `NEXT_PUBLIC_SITE_URL` (Vercel env var) to `https://your-domain.com` and redeploy.

---

## Option B — Self-host on a Node server (VPS)

```bash
pnpm install
pnpm build
pnpm start          # serves on :3000 (next start)
```
Put **nginx** (or Caddy) in front for TLS + your domain, reverse-proxying to `127.0.0.1:3000`.
Run `next start` under a process manager (`pm2`, systemd) so it survives restarts. Set the
same env vars from the table above in the service environment.

---

## After deploying — wire the domain into Supabase & Google

These steps are required for **login** and **payments** to work on the live domain.

### 1. Supabase Auth URLs  (Dashboard → Authentication → URL Configuration)
- **Site URL**: `https://your-domain.com`
- **Redirect URLs**: add `https://your-domain.com/**`
  (keep `http://localhost:3000/**` for local dev)

This is what allows the Google OAuth round-trip to redirect back to `/auth/callback`
on the live site. (Google Cloud needs no change — its redirect URI stays the Supabase
callback `https://wjdiojyelthaumuzkfxt.supabase.co/auth/v1/callback`.)

### 2. Edge Function `APP_URL`  (for Mobbex return URL, when you enable payments)
```bash
pnpm exec supabase secrets set APP_URL="https://your-domain.com"
```

### 3. Email from your own domain (Resend, free tier)

Both email paths — the OTP sign-in codes (Supabase Auth) and the booking
confirmation receipt (Edge Function) — send through [Resend](https://resend.com)
from your own domain. Free tier: 3,000 emails/month, 100/day, one domain.

1. **Verify the domain**: Resend dashboard → Domains → Add Domain → add the DNS
   records it shows (SPF/DKIM TXT + DMARC + MX) at your registrar, wait for
   **Verified**.
2. **Create an API key** (Resend → API Keys).
3. **Booking confirmation email** — set the Edge Function secrets:
   ```bash
   pnpm exec supabase secrets set \
     RESEND_API_KEY="re_..." \
     EMAIL_FROM="VULL <hola@your-domain.com>"
   ```
4. **OTP sign-in emails** — Dashboard → Authentication → Emails → SMTP:
   - Host `smtp.resend.com`, port `465`, user `resend`, pass = the API key
   - Sender email `hola@your-domain.com`, sender name `VULL`

   (Same values live commented in `supabase/config.toml` under
   `[auth.email.smtp]` — they stay commented so local dev keeps using Mailpit.)

Without this, hosted Auth falls back to Supabase's built-in SMTP, which is
rate-limited to a handful of emails per hour — fine for a quick test, not for real
users. Locally nothing is needed: OTP codes land in Mailpit (`:54324`).

### 4. Edge Functions must be deployed (separate from the frontend)
```bash
pnpm exec supabase functions deploy
```
The frontend calls these via `supabase.functions.invoke(...)`; they live on Supabase, not Vercel.

---

## Smoke test on the live domain
1. Load `https://your-domain.com` — landing renders, logo shows.
2. **Log in with Google** — redirects out and back, you land signed in.
3. As an admin, open **/admin/servicios** — create a plan; it appears on the landing.
4. Click **Reservar** → pick a slot from live availability → booking holds at `/turno/[id]`.

If login fails with a redirect error, the Redirect URL in step 1 above is almost always the cause.
