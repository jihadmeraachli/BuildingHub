-- ============================================================
-- BuildingHub — Storage RLS for attachments bucket
-- Run this AFTER switching the bucket to private in the dashboard:
--   Storage → Buckets → attachments → Edit → disable "Public bucket"
-- Safe to re-run (DROP IF EXISTS before CREATE).
-- ============================================================

-- Allow authenticated users to read any file in the attachments bucket.
-- Signed URLs are generated client-side (1-hour expiry) via getSignedUrl().
DROP POLICY IF EXISTS "attachments_read" ON storage.objects;
CREATE POLICY "attachments_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'attachments');

-- Allow authenticated users to upload files.
DROP POLICY IF EXISTS "attachments_insert" ON storage.objects;
CREATE POLICY "attachments_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'attachments');

-- Allow users to delete only files they uploaded.
DROP POLICY IF EXISTS "attachments_delete" ON storage.objects;
CREATE POLICY "attachments_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'attachments' AND owner = auth.uid()::text);
