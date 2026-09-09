-- ============================================================================
-- payments: Talo fields + the indexes that make settlement provably safe
-- ============================================================================
-- Separate file from 20260909120000 on purpose: the predicates below reference
-- the 'talo' enum value, which cannot be used in the transaction that added it.

alter table public.payments
  -- Talo's own payment id ("VAR-..."). The ONLY key the webhook resolves by.
  add column if not exists talo_payment_id text,
  -- The one-time CVU/alias handed to the client. Stored so the pay panel can be
  -- re-rendered (and the same CVU re-served) without another Talo round trip.
  add column if not exists talo_cvu   text,
  add column if not exists talo_alias text,
  -- When the CVU dies. Kept in sync with bookings.hold_expires_at so the money
  -- window and the slot hold are the same instant.
  add column if not exists talo_expires_at timestamptz,
  -- Money that came back out after we approved (refund / reversal). Deliberately
  -- NOT a payment_status value: 'pending'|'approved'|'rejected' is consumed in a
  -- dozen places and a fourth state would silently change all of them.
  add column if not exists reversed_at timestamptz,
  -- Set whenever a payment needs a human: 'underpaid', 'overpaid', 'unverified',
  -- 'amount_mismatch', 'paid_no_slot', 'reversed', 'expired_with_funds'.
  add column if not exists admin_flag text;

-- THE index. One payments row per Talo payment, so webhook resolution can never
-- be ambiguous and two rows can never claim the same money.
create unique index if not exists payments_talo_id_uniq
  on public.payments (talo_payment_id)
  where talo_payment_id is not null;

-- The webhook/reconciler fallback looks a row up by (provider, external_reference);
-- there was no index for that lookup at all.
create index if not exists payments_provider_extref_idx
  on public.payments (provider, external_reference);

-- Safety nets: at most ONE live CVU per payable target, so a double-click cannot
-- hand the client two different CVUs to transfer to. Two separate indexes because
-- a booking payment has booking_id set and a pack payment has it NULL — and NULLs
-- are distinct in a unique index, so a single (booking_id, provider) index would
-- give packs no protection whatsoever.
create unique index if not exists payments_talo_live_booking_uniq
  on public.payments (booking_id)
  where provider = 'talo' and status = 'pending' and booking_id is not null;

create unique index if not exists payments_talo_live_pack_uniq
  on public.payments (user_id, service_id)
  where provider = 'talo' and status = 'pending' and kind = 'pack';

-- Surfaced in the admin queue: anything still pending, or flagged, or reversed.
create index if not exists payments_needs_attention_idx
  on public.payments (created_at)
  where status = 'pending' or admin_flag is not null or reversed_at is not null;
