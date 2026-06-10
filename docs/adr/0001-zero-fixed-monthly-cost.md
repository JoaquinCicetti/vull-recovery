# ADR 0001 — Zero fixed monthly cost is the overriding constraint

- **Status:** Accepted
- **Date:** 2026-05-28

## Context
The system is for a friend's small recovery center. The explicit, hard
requirement is that it must not incur a fixed monthly bill. Per-transaction fees
(e.g. payment commissions) are acceptable because they scale with revenue.

## Decision
Treat "no fixed monthly cost" as the constraint that overrides convenience.
Every component must sit on a free tier or a pay-per-use model. This single rule
drives ADRs 0002–0007.

## Consequences
- Free tiers chosen: Supabase, Vercel/Cloudflare, Google Calendar API.
- Accept free-tier limits — notably Supabase pausing after ~7 days idle
  (mitigated by the `keep-alive` function + an external weekly cron).
- Payment provider must have no monthly fee (per-transaction only); where a
  provider has a low-volume monthly minimum, a truly-$0 fallback must exist.
- No paid SMS or business-initiated WhatsApp templates in v1.
- Some features that would add cost (transactional email, proactive reminders,
  WhatsApp Flows) are deferred.

## Alternatives considered
- Managed BaaS / hosting with a monthly plan (Firebase Blaze baseline, paid
  Postgres hosts) — rejected: violates the constraint.
