-- ============================================================================
-- booking_status += 'no_show'  (admin can mark a confirmed turno as a no-show)
-- ============================================================================
-- 'no_show' is a TERMINAL status, like cancelled/expired: it is deliberately NOT
-- in the active set {pending, awaiting_payment, confirmed}, so it does not hold a
-- slot (bookings_no_overlap) or a day (bookings_one_per_day) — the time frees
-- automatically, exactly like a cancellation. No constraint changes are needed
-- because those predicates list the active statuses explicitly.
alter type public.booking_status add value if not exists 'no_show';
