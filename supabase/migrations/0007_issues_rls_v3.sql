-- ============================================================
-- BuildingHub — bring issues RLS onto the v3 permission model
-- Fixes: "new row violates row-level security policy for table issues"
-- (platform admins / managers couldn't insert; old policy required
--  building_id = current_user_building()).
-- Safe to re-run.
-- ============================================================

DROP POLICY IF EXISTS "issues_select" ON issues;
DROP POLICY IF EXISTS "issues_insert" ON issues;
DROP POLICY IF EXISTS "issues_update_admin" ON issues;
DROP POLICY IF EXISTS "issues_delete" ON issues;

-- Read: platform admin / managers (issue.view_all) see all in the building;
-- residents see their own.
CREATE POLICY "issues_select" ON issues FOR SELECT USING (
  is_platform_admin()
  OR user_can(building_id, 'issue.view_all')
  OR reported_by = auth.uid()
  -- keep legacy admins working during migration
  OR current_user_role() = 'super_admin'
  OR (current_user_role() = 'building_admin' AND building_id = current_user_building())
);

-- Insert: must be the reporter, and either a manager or a member of the building
-- (platform admins & legacy admins always allowed).
CREATE POLICY "issues_insert" ON issues FOR INSERT WITH CHECK (
  reported_by = auth.uid()
  AND (
    is_platform_admin()
    OR user_can(building_id, 'issue.update')
    OR user_member_building(building_id)
    OR current_user_role() = 'super_admin'
    OR (current_user_role() = 'building_admin' AND building_id = current_user_building())
    OR building_id = current_user_building()
  )
);

-- Update: managers / platform admins / the reporter.
CREATE POLICY "issues_update" ON issues FOR UPDATE USING (
  is_platform_admin()
  OR user_can(building_id, 'issue.update')
  OR reported_by = auth.uid()
  OR current_user_role() = 'super_admin'
  OR (current_user_role() = 'building_admin' AND building_id = current_user_building())
);

-- Delete: managers / platform admins.
CREATE POLICY "issues_delete" ON issues FOR DELETE USING (
  is_platform_admin()
  OR user_can(building_id, 'issue.update')
  OR current_user_role() = 'super_admin'
  OR (current_user_role() = 'building_admin' AND building_id = current_user_building())
);
