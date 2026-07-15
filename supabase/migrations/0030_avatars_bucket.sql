-- ============================================================
-- 0030_avatars_bucket.sql
-- A public `avatars` bucket, separate from `attachments`.
--
-- Why: 0025 made `attachments` PRIVATE (invoices/receipts/issue photos are
-- sensitive — they're read via 1-hour signed URLs through AttachmentLink).
-- Avatars were being written there too, so <img src={avatar_url}> pointed at a
-- getPublicUrl() that 404s on a private bucket → broken image everywhere.
--
-- Signing avatars instead would be wrong: they render in the header and sidebar
-- on every page, so a 1-hour expiry means constant re-signing and stale <img>
-- src values. A profile photo is not an invoice — public is the right call, and
-- the path is unguessable (avatars/<uid>/<timestamp>-name).
--
-- Additive & idempotent. Transactional.
-- ============================================================
BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', TRUE)
ON CONFLICT (id) DO UPDATE SET public = TRUE;

-- Public read (that's the point of the bucket).
DROP POLICY IF EXISTS "avatars_read" ON storage.objects;
CREATE POLICY "avatars_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

-- Signed-in users may upload, but only into their OWN folder: avatars/<uid>/...
-- (storage.foldername(name))[1] is the first path segment.
DROP POLICY IF EXISTS "avatars_insert" ON storage.objects;
CREATE POLICY "avatars_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ...and may replace/remove only their own.
DROP POLICY IF EXISTS "avatars_update" ON storage.objects;
CREATE POLICY "avatars_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatars_delete" ON storage.objects;
CREATE POLICY "avatars_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

COMMIT;

-- ------------------------------------------------------------
-- Existing avatar_url values point at the now-private attachments bucket and
-- are broken. Clear them so people fall back to their initials and can re-upload:
--
--   UPDATE profiles SET avatar_url = NULL WHERE avatar_url LIKE '%/attachments/%';
-- ------------------------------------------------------------
