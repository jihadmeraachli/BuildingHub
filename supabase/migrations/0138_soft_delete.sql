-- ============================================================
-- 0138_soft_delete.sql
-- Make deleting a building / compound / unit / organization REVERSIBLE.
--
-- WHY. These were hard-deleted, cascading through up to 24 child tables — an
-- irreversible wipe of a customer's financial history on one click. Now a
-- delete is a soft-delete: the row is flagged and hidden, its children stay
-- put (the cascade never fires), and it can be restored for 30 days.
--
-- HOW (transparent trigger — no client change to the delete path).
--   · deleted_at / deleted_by columns on the four structural tables.
--   · A BEFORE DELETE trigger converts the FIRST delete of a live row into a
--     soft-delete (set deleted_at, cancel the hard delete). Deleting a row that
--     is ALREADY soft-deleted is allowed through as a real delete — that is how
--     the 30-day purge actually removes it (and the cascade fires then, on
--     purpose). So the existing supabase.from('buildings').delete() calls keep
--     working and simply become reversible.
--   · A RESTRICTIVE SELECT policy hides soft-deleted rows from every normal
--     read (so they vanish from the app), WITHOUT touching the existing
--     visibility policies — it just ANDs "deleted_at IS NULL" onto them.
--   · restore_entity() / list_trash() (SECURITY DEFINER, so they can see and
--     un-hide trashed rows) power the recycle bin. purge_soft_deleted() runs
--     daily via pg_cron and hard-deletes anything trashed > 30 days.
--
-- Audit: the soft-delete is an UPDATE, so 0137's audit_trg logs it (with
-- deleted_at old→new); the eventual purge logs a real DELETE. Full trail.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Columns.
-- ------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['buildings','compounds','units','organizations'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_by UUID', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (deleted_at) WHERE deleted_at IS NOT NULL', t||'_deleted_idx', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 2. The soft-delete trigger: first delete → soft; delete-again → real.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION soft_delete_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF OLD.deleted_at IS NULL THEN
    EXECUTE format('UPDATE %I SET deleted_at = now(), deleted_by = $1 WHERE id = $2', TG_TABLE_NAME)
      USING auth.uid(), OLD.id;
    RETURN NULL;             -- cancel the hard delete
  END IF;
  RETURN OLD;                -- already trashed → let the real (purge) delete proceed
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['buildings','compounds','units','organizations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS soft_delete_trg ON %I', t);
    -- name sorts before audit_trg/deny_demo_write? BEFORE-trigger order is by
    -- name; deny_demo_write_trg (demo block) must still run — it does, both are
    -- BEFORE and independent. This only converts a delete that actually proceeds.
    EXECUTE format(
      'CREATE TRIGGER soft_delete_trg BEFORE DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION soft_delete_guard()', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3. Hide soft-deleted rows from normal reads (restrictive = ANDs on).
-- ------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['buildings','compounds','units','organizations'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'hide_deleted_'||t, t);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT USING (deleted_at IS NULL)',
      'hide_deleted_'||t, t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 4. Who may restore/see the trash for a given entity.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION can_restore_entity(p_table TEXT, p_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_bid UUID; v_oid UUID;
BEGIN
  IF is_platform_admin() THEN RETURN TRUE; END IF;
  CASE p_table
    WHEN 'buildings' THEN
      RETURN user_can(p_id, 'building.manage');
    WHEN 'units' THEN
      SELECT building_id INTO v_bid FROM units WHERE id = p_id;
      RETURN v_bid IS NOT NULL AND user_can(v_bid, 'unit.manage');
    WHEN 'compounds' THEN
      RETURN user_manages_compound(p_id);
    WHEN 'organizations' THEN
      RETURN EXISTS (SELECT 1 FROM grants g
                     WHERE g.user_id = auth.uid() AND g.scope_type = 'org' AND g.org_id = p_id
                       AND (g.expires_at IS NULL OR g.expires_at >= CURRENT_DATE)
                       AND role_has_cap(g.role, 'building.manage'));
    ELSE RETURN FALSE;
  END CASE;
END;
$$;

-- ------------------------------------------------------------
-- 5. The recycle bin: list + restore.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_trash()
RETURNS TABLE(entity TEXT, id UUID, name TEXT, deleted_at TIMESTAMPTZ, deleted_by UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'buildings', b.id, b.name, b.deleted_at, b.deleted_by
    FROM buildings b WHERE b.deleted_at IS NOT NULL AND can_restore_entity('buildings', b.id)
  UNION ALL
  SELECT 'compounds', c.id, c.name, c.deleted_at, c.deleted_by
    FROM compounds c WHERE c.deleted_at IS NOT NULL AND can_restore_entity('compounds', c.id)
  UNION ALL
  SELECT 'organizations', o.id, o.name, o.deleted_at, o.deleted_by
    FROM organizations o WHERE o.deleted_at IS NOT NULL AND can_restore_entity('organizations', o.id)
  UNION ALL
  SELECT 'units', u.id, u.label, u.deleted_at, u.deleted_by
    FROM units u WHERE u.deleted_at IS NOT NULL AND can_restore_entity('units', u.id)
  ORDER BY 4 DESC;
$$;
REVOKE ALL ON FUNCTION list_trash() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION list_trash() TO authenticated;

CREATE OR REPLACE FUNCTION restore_entity(p_table TEXT, p_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_table NOT IN ('buildings','compounds','units','organizations') THEN
    RAISE EXCEPTION 'Not a restorable entity.' USING ERRCODE = '22023';
  END IF;
  IF NOT can_restore_entity(p_table, p_id) THEN
    RAISE EXCEPTION 'Not allowed to restore this.' USING ERRCODE = '42501';
  END IF;
  EXECUTE format('UPDATE %I SET deleted_at = NULL, deleted_by = NULL WHERE id = $1', p_table)
    USING p_id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION restore_entity(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION restore_entity(TEXT, UUID) TO authenticated;

-- ------------------------------------------------------------
-- 6. The purge: hard-delete anything trashed > 30 days. The BEFORE DELETE
--    trigger lets these through (deleted_at IS NOT NULL) → cascade fires.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION purge_soft_deleted()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT := 0; v_c INT; t TEXT;
BEGIN
  -- units first, then buildings/compounds, then orgs — reduce cascade surprises.
  FOREACH t IN ARRAY ARRAY['units','buildings','compounds','organizations'] LOOP
    EXECUTE format('DELETE FROM %I WHERE deleted_at IS NOT NULL AND deleted_at < now() - INTERVAL ''30 days''', t);
    GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n + v_c;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION purge_soft_deleted() FROM PUBLIC, anon, authenticated;
-- service_role (the cron) and platform admins (via SQL editor) only.

COMMIT;

-- ------------------------------------------------------------
-- 7. Schedule the daily purge (best-effort; needs pg_cron enabled).
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-soft-deleted') THEN
      PERFORM cron.unschedule('purge-soft-deleted');
    END IF;
    PERFORM cron.schedule('purge-soft-deleted', '30 3 * * *', 'SELECT purge_soft_deleted()');
    RAISE NOTICE 'Scheduled purge-soft-deleted at 03:30 UTC daily.';
  ELSE
    RAISE NOTICE 'pg_cron not enabled — run this once it is: SELECT cron.schedule(''purge-soft-deleted'',''30 3 * * *'',''SELECT purge_soft_deleted()'');';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule purge (%). Schedule it by hand later.', SQLERRM;
END $$;

-- Post-run checks:
--   Delete a test building in the app → it disappears from the list (soft), and
--     SELECT deleted_at FROM buildings WHERE id = ... shows a timestamp; its
--     units/charges rows are still in the DB.
--   SELECT * FROM list_trash();  → shows it.
--   SELECT restore_entity('buildings', '<id>');  → it reappears in the app.
--   A non-manager cannot see it in list_trash() or restore it (42501).
--   purge only removes rows deleted_at < 30 days ago (test by back-dating one).
--
-- KNOWN v1 limits (fine to ship, note for later):
--   · Children of a soft-deleted building stay visible via direct query, but the
--     app navigates through the parent so they don't surface. A later pass can
--     cascade-hide them.
--   · Buildings.tsx deletes the org_buildings link before deleting the building,
--     so restoring re-shows the building but not its org attachment (re-link in UI).
