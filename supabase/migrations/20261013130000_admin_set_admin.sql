-- ============================================================================
-- Promote / demote administrators from the backoffice
-- ============================================================================
-- profiles.is_admin is not writable from the browser (column grants in
-- 20260630120000), so until now making someone an admin meant running SQL.
-- This is the one sanctioned path: SECURITY DEFINER, gated on the CALLER being
-- an admin already (is_admin() reads their committed row via auth.uid()).
--
-- An admin cannot remove their own flag. That is what guarantees the panel can
-- never end up with zero admins: the last one standing has nobody to demote
-- them. guard_profile_privileges() lets the update through because the caller
-- is an admin.
create or replace function public.admin_set_admin(p_user uuid, p_value boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_value is null then
    raise exception 'Valor inválido' using errcode = 'P0001';
  end if;
  if p_user = auth.uid() and not p_value then
    raise exception 'No podés quitarte el permiso de administrador a vos mismo'
      using errcode = 'P0001';
  end if;

  update public.profiles set is_admin = p_value where id = p_user;
  if not found then
    raise exception 'Cliente inexistente' using errcode = 'P0001';
  end if;
  return p_value;
end;
$$;

revoke execute on function public.admin_set_admin(uuid, boolean) from public, anon;
grant  execute on function public.admin_set_admin(uuid, boolean) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.admin_set_admin(uuid, boolean)', 'execute') then
    raise exception 'admin_set_admin is still EXECUTE-able by anon';
  end if;
end $$;
