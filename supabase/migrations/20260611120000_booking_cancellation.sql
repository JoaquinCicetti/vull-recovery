-- ============================================================================
-- Booking cancellation — audit fields
-- ============================================================================
-- Cancelling sets status='cancelled'. The slot is freed automatically: the
-- `bookings_no_overlap` EXCLUDE constraint only covers
-- ('pending','awaiting_payment','confirmed'), so a cancelled booking no longer
-- blocks its time. These columns record who cancelled, when, and why.
--
-- Writes still happen server-side (service_role) via the `cancel-booking` Edge
-- Function, so no new RLS policy is needed — browser reads already see own rows.

alter table public.bookings
  add column if not exists cancelled_at        timestamptz,
  add column if not exists cancelled_by        uuid references public.profiles(id),
  add column if not exists cancellation_reason text;
