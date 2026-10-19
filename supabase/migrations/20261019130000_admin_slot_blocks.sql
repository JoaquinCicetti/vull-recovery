-- Admin slot blocks (ADR 0014): manual confirmation is gone — a turno is paid
-- through Talo or it is not paid — and the desk's cash clients are handled by
-- the admin BLOCKING the slot under a name instead.
--
-- A block is a bookings row with no client (user_id null) and a label. It is a
-- booking in every other respect, which is the point: the EXCLUDE constraint
-- keeps it race-safe against online bookings, `availability` and the abono
-- roll see it as taken, the Google event is created like any other, and the
-- agenda lists it in its slot. Nothing client-facing can ever read it
-- (bookings_select_own: user_id = auth.uid() never matches null).

alter table public.bookings alter column user_id drop not null;

alter table public.bookings
  add column block_label text,
  add column block_by    uuid references public.profiles(id);

comment on column public.bookings.block_label is
  'Set on an admin block (a slot held under a name, no client). Null on every real turno.';
comment on column public.bookings.block_by is
  'The admin who blocked the slot.';

-- Exactly one of: a client (user_id) or a label. Never both, never neither.
alter table public.bookings
  add constraint bookings_block_shape check (
    (user_id is null) = (block_label is not null)
    and (block_label is null or length(btrim(block_label)) between 1 and 60)
  );

-- bookings_one_per_day is unique on (user_id, sector_id, local day): NULLs are
-- distinct there, so any number of blocks may share a day. bookings_no_overlap
-- (resource, time range) applies to blocks exactly as to turnos.

-- ─── notices: a block has nobody to tell ────────────────────────────────────
-- The three transitions queue a notice to b.user_id. For a block that would be
-- a row for nobody, left failing in the outbox; skip it instead. Admin-side
-- notices were already skipped for admin actors.

create or replace function public.confirm_booking(
  p_booking uuid,
  p_payment uuid,
  p_actor   text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then return 'gone'; end if;
  if b.status = 'confirmed' then return 'already'; end if;
  if b.status not in ('pending', 'awaiting_payment') then return 'gone'; end if;

  update public.bookings set status = 'confirmed', hold_expires_at = null where id = b.id;
  if p_payment is not null then
    update public.payments set status = 'approved', admin_flag = null
     where id = p_payment and status <> 'approved';
  end if;

  if b.user_id is not null then
    perform public.emit_notification('booking_confirmed', b.id, 'user', p_actor, b.user_id,
                                     jsonb_build_object('funded', 'payment'));
    if p_actor <> 'admin' then
      perform public.emit_notification('booking_confirmed', b.id, 'admins', p_actor, b.user_id,
                                       jsonb_build_object('funded', 'payment'));
    end if;
  end if;
  return 'ok';
end;
$$;

create or replace function public.cancel_booking(
  p_booking  uuid,
  p_by       uuid,
  p_reason   text,
  p_by_admin boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  b        public.bookings;
  v_credit text;
  v_actor  text := case when p_by_admin then 'admin' else 'client' end;
begin
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by,
         cancellation_reason = p_reason, hold_expires_at = null
   where id = p_booking and status in ('pending', 'awaiting_payment', 'confirmed')
  returning * into b;
  if not found then return 'gone'; end if;

  update public.payments set status = 'rejected'
   where booking_id = b.id and status = 'pending';

  if b.block_label is not null then
    -- A block holds no money and tells nobody.
    return 'block';
  end if;

  -- An abono class frees its bed and returns nothing (ADR 0011).
  if b.membership_id is not null then
    v_credit := 'membership';
  else
    v_credit := public.return_cancelled_booking(b.id, p_by_admin);
  end if;

  perform public.emit_notification('booking_cancelled', b.id, 'user', v_actor, b.user_id,
                                   jsonb_build_object('credit', v_credit, 'by_admin', p_by_admin));
  if not p_by_admin then
    perform public.emit_notification('booking_cancelled', b.id, 'admins', v_actor, b.user_id,
                                     jsonb_build_object('credit', v_credit));
  end if;
  return v_credit;
end;
$$;

create or replace function public.reschedule_booking(
  p_booking  uuid,
  p_starts   timestamptz,
  p_ends     timestamptz,
  p_resource uuid,
  p_actor    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.status not in ('pending', 'awaiting_payment', 'confirmed') then
    return jsonb_build_object('result', 'gone');
  end if;

  update public.bookings
     set starts_at = p_starts, ends_at = p_ends, resource_id = p_resource
   where id = b.id;

  -- A bed change at the same time is not news to the client; a block has none.
  if p_starts <> b.starts_at and b.user_id is not null then
    -- Each move is its own notice (A→B→A must tell the client twice).
    perform public.emit_notification('booking_rescheduled', b.id, 'user', p_actor, b.user_id,
              jsonb_build_object('previous_starts_at', b.starts_at, 'starts_at', p_starts),
              p_starts::text || '@' || now()::text);
    if p_actor <> 'admin' then
      perform public.emit_notification('booking_rescheduled', b.id, 'admins', p_actor, b.user_id,
                jsonb_build_object('previous_starts_at', b.starts_at, 'starts_at', p_starts),
                p_starts::text || '@' || now()::text);
    end if;
  end if;
  return jsonb_build_object('result', 'ok', 'previous_starts_at', b.starts_at);
end;
$$;
