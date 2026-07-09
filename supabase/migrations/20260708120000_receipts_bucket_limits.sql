-- ============================================================================
-- Harden the `receipts` bucket: enforce a size cap and a web-displayable MIME
-- allowlist at the storage layer, matching the create-payment RECEIPT_EXT
-- contract (png/jpg/webp/pdf). The client re-encodes HEIC/HEIF to JPEG before
-- upload, so no HEIC ever reaches storage.
-- ============================================================================

update storage.buckets
set
  file_size_limit = 20971520, -- 20 MiB
  allowed_mime_types = array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/pdf'
  ]
where id = 'receipts';
