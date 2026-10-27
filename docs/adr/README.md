# Architecture Decision Records

Each ADR captures one significant decision: its context, the choice, the
consequences, and the alternatives we rejected. Format is lightweight
(MADR-style). Status values: `Proposed` · `Accepted` · `Superseded`.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-zero-fixed-monthly-cost.md) | Zero fixed monthly cost is the overriding constraint | Accepted |
| [0002](0002-whatsapp-client-initiated-window.md) | WhatsApp via client-initiated `wa.me` + 24h free window | Accepted |
| [0003](0003-payments-mobbex-with-manual-fallback.md) | Payments via Mobbex, manual receipt as $0 fallback | Superseded by 0010 |
| [0004](0004-supabase-as-backend.md) | Supabase (Postgres/Auth/Storage/Edge Functions) as backend | Accepted |
| [0005](0005-email-otp-auth.md) | Passwordless email OTP for login | Accepted |
| [0006](0006-google-calendar-availability.md) | Google Calendar (service account) for availability | Accepted |
| [0007](0007-db-level-no-double-booking.md) | DB-level no-double-booking + lazy hold expiry | Accepted |
| [0008](0008-resend-email-provider.md) | Resend as the email provider (own domain) | Accepted |
| [0009](0009-booking-invariants-enforcement.md) | One-per-day at the DB; re-validate booking rules at the edge | Accepted |
| [0010](0010-payments-talo-transfers.md) | Payments via Talo automatic bank transfers (manual receipt fallback superseded by 0014) | Accepted |
| [0011](0011-memberships-as-materialized-bookings.md) | Monthly plans (abonos) as materialized bookings | Accepted |
| [0012](0012-admin-defined-slots-and-booking-window.md) | Admin-defined slots and a weekly client booking window | Accepted |
| [0013](0013-notification-outbox.md) | Notifications as an outbox written beside the invariant | Accepted |
| [0014](0014-no-manual-confirmation-admin-slot-blocks.md) | No manual confirmation; cash at the desk is an admin slot block | Accepted |
| [0015](0015-latency-worker-at-db-region-one-round-trip.md) | Latency: Worker placed at the DB region, local session check, one round trip per page; sa-east-1 move as the structural fix | Accepted |
