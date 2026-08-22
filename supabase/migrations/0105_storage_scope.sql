-- ============================================================
-- 0105_storage_scope.sql
-- Scope the attachments bucket to the building the file belongs to (2026-08-22).
--
-- THE HOLE. Every table in this schema is scoped by RLS. The FILES were not.
-- 0025 grants SELECT on any object in `attachments` to any authenticated user,
-- which means a signed-in resident of one building can read the invoices,
-- receipts, contracts and inspection photos of every other building on the
-- platform.
--
-- And they do not need to guess a path. Verified before writing this, signed in
-- as an ordinary demo account:
--
--   storage.from('attachments').list('')
--     -> 92d6cce9-…  avatars  feedback
--   …/contracts/1782331689743-Screenshot….png
--   …/expenses/1782328421036-Screenshot….png
--   …/payments/1782333365951-Screenshot….png
--
-- The bucket enumerates. From there a signed URL for any of it is one call.
--
-- WHAT THE PATH ALREADY TELLS US. Every uploader puts the owning id first:
--   {building|compound id}/contracts|expenses|inspections|meetings|nizam/…
--   {unit id}/payments/…
--   feedback/{user id}/…
--   avatars/{user id}/…
-- So the first segment is enough to answer "who may see this", using the same
-- user_sees_building / user_sees_compound helpers the tables use (0096). The
-- files stop being a second, weaker access model sitting beside the real one.
--
-- AVATARS STAY OPEN to signed-in users. A profile picture is shown next to a
-- name on every screen in the building; pretending it is confidential would be
-- theatre. FEEDBACK is the opposite: a screenshot of someone's own screen, so
-- only its author and a platform admin.
--
-- ⚠️ RUN THE DIAGNOSTIC BELOW FIRST. It lists objects whose path does not match
-- any known shape. Those become invisible to everyone except platform admins
-- the moment the policy lands. Expect zero. If it is not zero, move or delete
-- those objects before running the rest, or you will hide a live attachment.
--
-- Additive & idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- DIAGNOSTIC — run this on its own, first. Expect 0 rows.
-- ------------------------------------------------------------
--   SELECT name FROM storage.objects
--    WHERE bucket_id = 'attachments'
--      AND split_part(name, '/', 1) NOT IN ('avatars', 'feedback')
--      AND NOT EXISTS (SELECT 1 FROM buildings b WHERE b.id::text = split_part(name, '/', 1))
--      AND NOT EXISTS (SELECT 1 FROM compounds c WHERE c.id::text = split_part(name, '/', 1))
--      AND NOT EXISTS (SELECT 1 FROM units    u WHERE u.id::text = split_part(name, '/', 1));

BEGIN;

-- ------------------------------------------------------------
-- Who may read one object, decided from its path.
--
-- SECURITY DEFINER because it reads buildings/compounds/units to resolve the
-- id, and the caller must not need rights on those tables to have their own
-- file checked. STABLE so a listing does not re-run it per row unnecessarily.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION user_sees_attachment(p_name TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  head TEXT := split_part(p_name, '/', 1);
  second TEXT := split_part(p_name, '/', 2);
  ref UUID;
BEGIN
  IF is_platform_admin() THEN RETURN TRUE; END IF;
  IF head = '' THEN RETURN FALSE; END IF;

  -- Profile pictures: already visible beside every name in the building.
  IF head = 'avatars' THEN RETURN TRUE; END IF;

  -- A feedback screenshot is a picture of someone's own screen.
  IF head = 'feedback' THEN RETURN second = auth.uid()::text; END IF;

  -- Anything else is keyed by the id of the thing it belongs to. A path that
  -- is not a uuid is not a path this app writes, so it is not readable.
  BEGIN
    ref := head::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN FALSE;
  END;

  RETURN user_sees_building(ref)
      OR user_sees_compound(ref)
      OR EXISTS (SELECT 1 FROM units u WHERE u.id = ref AND user_sees_building(u.building_id));
END; $$;

GRANT EXECUTE ON FUNCTION user_sees_attachment(TEXT) TO authenticated;

COMMENT ON FUNCTION user_sees_attachment(TEXT) IS
  'Whether the caller may read one object in the attachments bucket, decided from the first path segment: a building/compound/unit id they can see, their own feedback folder, or an avatar. Platform admin sees all.';

-- ------------------------------------------------------------
-- Replace the blanket read. Same policy name as 0025 so this supersedes it
-- rather than sitting beside it: permissive policies OR together, and a tight
-- policy next to a loose one changes nothing at all.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "attachments_read" ON storage.objects;
CREATE POLICY "attachments_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'attachments' AND user_sees_attachment(name));

-- Writing into somebody else's folder was equally unguarded: the old policy
-- allowed any authenticated user to insert anywhere in the bucket.
DROP POLICY IF EXISTS "attachments_insert" ON storage.objects;
CREATE POLICY "attachments_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'attachments' AND user_sees_attachment(name));

-- Delete stays owner-only, now with a platform-admin escape so an operator can
-- clear an orphan without impersonating whoever uploaded it.
DROP POLICY IF EXISTS "attachments_delete" ON storage.objects;
CREATE POLICY "attachments_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'attachments' AND (owner::uuid = auth.uid() OR is_platform_admin()));

COMMIT;

-- ============================================================
-- Post-run checks:
--   Signed in as an ordinary resident of ONE building, the bucket no longer
--   enumerates into other buildings:
--     supabase.storage.from('attachments').list('')      -- only what they see
--
--   Their own building's invoice still opens:
--     open any expense with an attachment in Finance     -- downloads
--
--   Another building's file does not, even with the exact path:
--     createSignedUrl('<other building id>/expenses/x')  -- error
--
--   A resident cannot write into another building's folder:
--     upload to '<other building id>/expenses/evil.png'  -- denied
--
--   node scripts/check-storage-scope.mjs drives all of the above with the
--   personas in scripts/rls-personas.json.
-- ============================================================
