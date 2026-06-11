# ADR 0008 — Resend as the email provider (own domain)

- **Status:** Accepted
- **Date:** 2026-06-10

## Context
Email originally went out through a personal Gmail account: the booking
confirmation receipt via Gmail SMTP (app password), and hosted Auth OTP codes via
Supabase's built-in SMTP (rate-limited to a few emails/hour, not for production).
Sending from `@gmail.com` looks unprofessional and Gmail SMTP isn't meant for
transactional volume.

## Decision
Use **Resend** (free tier) for both email paths, sending from our own domain:

- **Booking confirmation** — `_shared/email.ts` calls the Resend HTTP API
  (`RESEND_API_KEY` + `EMAIL_FROM` Edge Function secrets).
- **OTP sign-in codes** — Supabase Auth custom SMTP pointed at
  `smtp.resend.com` (the same API key is the SMTP password).

Free tier: 3,000 emails/month, **100/day**, one verified domain. That covers
current sign-in + booking volume; consequence of [ADR 0001](0001-zero-fixed-monthly-cost.md)
(zero fixed monthly cost).

## Consequences
- Emails come from `hola@<our-domain>` with SPF/DKIM/DMARC — better deliverability
  than Gmail SMTP, and no app-password / 2FA coupling to a personal account.
- One secret (`RESEND_API_KEY`) covers both paths.
- One-time DNS setup at the registrar to verify the domain.
- If sign-ins approach 100 emails/day, revisit: Brevo's free tier allows 300/day,
  or move to a Resend paid plan.
- Local dev unchanged: OTP codes still land in Mailpit (`:54324`); the booking
  email no-ops when `RESEND_API_KEY` is unset.

## Alternatives considered
- **Keep Gmail SMTP** — free, but personal-account coupling, weak deliverability,
  daily caps designed for humans, and `@gmail.com` as sender. Rejected.
- **Brevo** — bigger free daily cap (300/day) but clunkier API. Keep as fallback.
- **AWS SES** — cheapest at scale, but no real free tier off-EC2 and sandbox
  approval friction. Rejected for v1.
