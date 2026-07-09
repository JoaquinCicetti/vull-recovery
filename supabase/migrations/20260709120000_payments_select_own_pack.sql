-- ============================================================================
-- Let a user read their own PACK payment.
-- ============================================================================
-- payments_select_own (init.sql) reached the owner only through
-- `booking_id -> bookings.user_id`. A pack payment has `booking_id is null` and
-- carries `user_id` directly (see the payments_shape_check added in
-- 20260701120000_packs_credits.sql), so that exists() never matched and the
-- buyer could not see their own purchase. /comprar/exito needs to read the
-- payment's status to know whether the credits have been granted.

drop policy if exists payments_select_own on public.payments;

create policy payments_select_own on public.payments
  for select using (
    public.is_admin()
    -- Pack purchase: the buyer is on the row itself.
    or payments.user_id = auth.uid()
    -- Booking payment: the owner is reached through the booking.
    or exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id and b.user_id = auth.uid()
    )
  );
