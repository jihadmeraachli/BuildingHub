-- ============================================================
-- 0135_storage_upload_limits.sql
-- HARDENING (audit M6, medium): no server-side upload type/size enforcement.
--
-- THE GAP. uploadFile() and the HTML `accept` hint are client-only, trivially
-- bypassed by calling the storage API directly. Nothing capped file size (cost
-- / DoS via huge uploads) or content-type (an uploaded text/html or image/svg+xml
-- is served inline from *.supabase.co — a phishing/script page on the storage
-- domain; cross-origin from the app, hence medium not high).
--
-- THE FIX. Bucket-level allowed_mime_types + file_size_limit — enforced by
-- storage regardless of client. Allowlist is deliberately broad (images, PDF,
-- common office docs) so real uploads keep working; it EXCLUDES text/html,
-- svg, and scripts, which is the point. Widen the array if a legitimate type
-- is ever rejected.
--
-- Idempotent (UPDATE of existing rows).
-- ============================================================
BEGIN;

-- attachments: invoices, receipts, contracts, inspection photos, project files.
UPDATE storage.buckets
   SET file_size_limit = 15728640,   -- 15 MB
       allowed_mime_types = ARRAY[
         'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'text/csv'
       ]
 WHERE id = 'attachments';

-- avatars: profile pictures only.
UPDATE storage.buckets
   SET file_size_limit = 5242880,    -- 5 MB
       allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
 WHERE id = 'avatars';

COMMIT;

-- Post-run checks:
--   Upload a normal PDF invoice / JPG receipt / profile photo → still works.
--   Try to upload a .html or .svg to attachments (direct API) → rejected by storage.
--   Try a 50 MB file → rejected (over the limit).
--   If a real upload type gets rejected, add its MIME to the array above.
