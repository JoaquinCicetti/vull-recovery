# ADR 0005 — Passwordless email OTP for login

- **Status:** Accepted
- **Date:** 2026-05-28

## Context
We want "light login" so returning clients can see their bookings, at zero cost.

## Decision
Use Supabase Auth passwordless **email OTP** (6-digit code). The `magic_link`
email template is customized to display the code so the user can stay in the app.

## Consequences
- Free; no SMS/WhatsApp provider needed.
- Requires the client to access their email; in local dev the code appears in
  Mailpit (`:54324`).
- A profile row is auto-created on signup (DB trigger) and the WhatsApp number is
  collected in the account page.

## Alternatives considered
- **WhatsApp/SMS OTP** — costs per message and needs a paid provider (Twilio).
  Rejected (ADR 0001).
- **No login / phone-only identity** — simpler, but weaker for a "my bookings"
  history. Rejected for v1; accounts give a better experience for $0.
