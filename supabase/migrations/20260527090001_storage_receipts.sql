-- ============================================================================
-- Storage: private bucket for manual bank-transfer receipt images.
-- Path convention: receipts/<user_id>/<booking_id>-<timestamp>.<ext>
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- A user may upload only into their own folder (first path segment = their uid).
create policy "receipts insert own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- A user may read their own receipts; admins may read all.
create policy "receipts read own or admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );
