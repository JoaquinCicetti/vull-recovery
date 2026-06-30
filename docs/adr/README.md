# Architecture Decision Records

Each ADR captures one significant decision: its context, the choice, the
consequences, and the alternatives we rejected. Format is lightweight
(MADR-style). Status values: `Proposed` · `Accepted` · `Superseded`.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-zero-fixed-monthly-cost.md) | Zero fixed monthly cost is the overriding constraint | Accepted |
| [0002](0002-whatsapp-client-initiated-window.md) | WhatsApp via client-initiated `wa.me` + 24h free window | Accepted |
| [0003](0003-payments-mobbex-with-manual-fallback.md) | Payments via Mobbex, manual receipt as $0 fallback | Accepted |
| [0004](0004-supabase-as-backend.md) | Supabase (Postgres/Auth/Storage/Edge Functions) as backend | Accepted |
| [0005](0005-email-otp-auth.md) | Passwordless email OTP for login | Accepted |
| [0006](0006-google-calendar-availability.md) | Google Calendar (service account) for availability | Accepted |
| [0007](0007-db-level-no-double-booking.md) | DB-level no-double-booking + lazy hold expiry | Accepted |
| [0008](0008-resend-email-provider.md) | Resend as the email provider (own domain) | Accepted |
| [0009](0009-booking-invariants-enforcement.md) | One-per-day at the DB; re-validate booking rules at the edge | Accepted |
