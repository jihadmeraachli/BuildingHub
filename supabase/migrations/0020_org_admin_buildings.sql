-- 0020: let org_admins create and manage buildings within their org
-- Additive & idempotent — safe to re-run.

-- Allow org_admin to INSERT new buildings (no org_buildings row exists yet for new buildings,
-- so we check role only here; the manage policy below handles UPDATE/DELETE via org_buildings).
DROP POLICY IF EXISTS "buildings_insert_org_admin" ON buildings;
CREATE POLICY "buildings_insert_org_admin" ON buildings
  FOR INSERT TO authenticated
  WITH CHECK (
    is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM grants
      WHERE grants.user_id = auth.uid()
        AND grants.scope_type = 'org'
        AND grants.role = 'org_admin'
    )
  );

-- Allow org_admin to UPDATE / DELETE buildings already linked to their org.
DROP POLICY IF EXISTS "buildings_manage_org_admin" ON buildings;
CREATE POLICY "buildings_manage_org_admin" ON buildings
  FOR ALL TO authenticated
  USING (
    is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM org_buildings ob
      JOIN grants g ON g.org_id = ob.org_id
      WHERE ob.building_id = buildings.id
        AND g.user_id = auth.uid()
        AND g.scope_type = 'org'
        AND g.role = 'org_admin'
    )
  )
  WITH CHECK (
    is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM org_buildings ob
      JOIN grants g ON g.org_id = ob.org_id
      WHERE ob.building_id = buildings.id
        AND g.user_id = auth.uid()
        AND g.scope_type = 'org'
        AND g.role = 'org_admin'
    )
  );

-- Expand org_buildings write so org_admins can link/unlink buildings within their own org.
DROP POLICY IF EXISTS "org_buildings_write" ON org_buildings;
CREATE POLICY "org_buildings_write" ON org_buildings FOR ALL
  USING (
    is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM grants g
      WHERE g.user_id = auth.uid()
        AND g.scope_type = 'org'
        AND g.role = 'org_admin'
        AND g.org_id = org_buildings.org_id
    )
  )
  WITH CHECK (
    is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM grants g
      WHERE g.user_id = auth.uid()
        AND g.scope_type = 'org'
        AND g.role = 'org_admin'
        AND g.org_id = org_buildings.org_id
    )
  );
