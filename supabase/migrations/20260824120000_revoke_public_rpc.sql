-- ============================================================================
-- Close the credit RPCs to the browser (security P0)
-- ============================================================================
-- 20260701120000_packs_credits.sql ended with:
--
--   revoke execute on function public.adjust_credit(...) from anon, authenticated;
--
-- That does NOT take the privilege away. PostgreSQL grants `EXECUTE` to the
-- pseudo-role **PUBLIC** on every function at creation time, and a REVOKE aimed
-- at a specific role never strips a PUBLIC grant: `anon` and `authenticated`
-- kept EXECUTE by inheriting it from PUBLIC. (`create or replace function`
-- preserves the existing ACL, so recreating grant_pack_credits in
-- 20260702130000 did not change this either.)
--
-- Every one of these five is SECURITY DEFINER, lives in the PostgREST-exposed
-- `public` schema, and takes the acting user as a PARAMETER rather than reading
-- auth.uid(). With only the publishable (anon) key that ships in the browser
-- bundle, the whole credit subsystem was callable:
--
--   POST /rest/v1/rpc/adjust_credit
--        {"p_user":"<any uid>","p_service":"<any>","p_delta":9999,
--         "p_note":"","p_admin":null}                  -> unlimited free sessions
--   POST /rest/v1/rpc/book_with_credit                 -> a `confirmed` booking for
--        any user, at any hour, bypassing working hours, the 60-minute lead time,
--        the pack price guard and the use_credit gate in create-booking
--   POST /rest/v1/rpc/credit_balance                   -> read anyone's balance
--
-- The edge functions reach these through the service-role key, which BYPASSES
-- privilege checks, so revoking from PUBLIC costs the app nothing.
--
-- `my_credit_balances()` is the ONE credit function the browser legitimately
-- calls (lib/credits.ts -> getMyBalances). It is auth.uid()-scoped internally
-- and takes no parameters, so it keeps its grant to `authenticated`.

revoke execute on function public.credit_balance(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.book_with_credit(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.grant_pack_credits(uuid)
  from public, anon, authenticated;
revoke execute on function public.refund_booking_credit(uuid)
  from public, anon, authenticated;
revoke execute on function public.adjust_credit(uuid, uuid, int, text, uuid)
  from public, anon, authenticated;

-- The browser's own-balance read stays open (re-granted idempotently in case a
-- future `revoke ... from public` on the schema catches it).
revoke execute on function public.my_credit_balances() from public, anon;
grant  execute on function public.my_credit_balances() to authenticated;

-- ─── Assert the lockdown, so a bad deploy fails loudly instead of silently ───
-- has_function_privilege() resolves PUBLIC inheritance, which is exactly the
-- thing the original revoke missed.
do $$
declare
  fn   text;
  role text;
  fns  text[] := array[
    'public.credit_balance(uuid, uuid)',
    'public.book_with_credit(uuid, uuid, timestamptz, timestamptz)',
    'public.grant_pack_credits(uuid)',
    'public.refund_booking_credit(uuid)',
    'public.adjust_credit(uuid, uuid, int, text, uuid)'
  ];
begin
  foreach fn in array fns loop
    foreach role in array array['anon', 'authenticated'] loop
      if has_function_privilege(role, fn, 'execute') then
        raise exception '% is still EXECUTE-able by %', fn, role;
      end if;
    end loop;
  end loop;

  if not has_function_privilege('authenticated', 'public.my_credit_balances()', 'execute') then
    raise exception 'my_credit_balances() must stay callable by authenticated';
  end if;
end $$;
