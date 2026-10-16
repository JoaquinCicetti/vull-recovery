-- ============================================================================
-- Cash payments recorded by an admin
-- ============================================================================
-- An admin who sells an abono at the desk records the cash as a real payments
-- row (provider 'cash', approved), so the money shows up in the client's
-- history and in revenue instead of only flipping a status.
--
-- Alone in its file: PostgreSQL refuses to USE an enum value in the same
-- transaction that adds it (same split as 20260909120000 / 20260909120100).
alter type public.payment_provider add value if not exists 'cash';
