-- ============================================================
-- BuildingHub — storage bucket for all attachments
-- Fixes "Bucket not found". Creates ONE public bucket used by
-- expenses (invoices), payments (receipts) and meetings (files).
-- Safe to re-run.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', TRUE)
ON CONFLICT (id) DO UPDATE SET public = TRUE;

-- Anyone can read (public bucket); authenticated users can upload.
DROP POLICY IF EXISTS "attachments_read" ON storage.objects;
DROP POLICY IF EXISTS "attachments_write" ON storage.objects;
DROP POLICY IF EXISTS "attachments_update" ON storage.objects;
DROP POLICY IF EXISTS "attachments_delete" ON storage.objects;

CREATE POLICY "attachments_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'attachments');

CREATE POLICY "attachments_write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'attachments');

CREATE POLICY "attachments_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'attachments');

CREATE POLICY "attachments_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'attachments');
