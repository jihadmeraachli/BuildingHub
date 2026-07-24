-- ============================================================
-- 0040_critical_access_fixes.sql
-- Fixes the two CRITICAL findings of the 2026-07-25 permission audit.
--
-- C1 — org_buildings takeover: org_buildings_write (0020) checked only the
--      ORG side of a link. Any authenticated user could self-register an org
--      (0031/0037 self-service), then INSERT (my_org, victim_building) and
--      user_can() would cascade full admin capabilities over ANY building on
--      the platform. Linking now requires authority over BOTH sides.
--
-- C2 — reactivate_user() had no authorization at all: any authenticated user
--      could reactivate any deactivated account (and the guard's reactivation
--      branch wipes the audit trail). Now mirrors the deactivation rules.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- C1. org_buildings: linking requires authority over BOTH the org AND the
--     building. Self-service stays intact: a building created by an org admin
--     auto-grants them building_admin (0031), so their own link succeeds.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "org_buildings_write" ON org_buildings;

-- Platform operator: unrestricted.
DROP POLICY IF EXISTS "org_buildings_all_platform" ON org_buildings;
CREATE POLICY "org_buildings_all_platform" ON org_buildings
  FOR ALL TO authenticated
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- Org admin may LINK a building only if they also control the building itself.
DROP POLICY IF EXISTS "org_buildings_link" ON org_buildings;
CREATE POLICY "org_buildings_link" ON org_buildings
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM grants g
      WHERE g.user_id = auth.uid()
        AND g.scope_type = 'org' AND g.role = 'org_admin'
        AND g.org_id = org_buildings.org_id
    )
    AND user_can(org_buildings.building_id, 'building.manage')
  );

-- Org admin may UNLINK buildings from their own org (org side is enough:
-- removing a link only ever shrinks their own reach).
DROP POLICY IF EXISTS "org_buildings_unlink" ON org_buildings;
CREATE POLICY "org_buildings_unlink" ON org_buildings
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM grants g
      WHERE g.user_id = auth.uid()
        AND g.scope_type = 'org' AND g.role = 'org_admin'
        AND g.org_id = org_buildings.org_id
    )
  );
-- (No UPDATE policy for non-platform users: links are created and removed, never edited.)

-- ------------------------------------------------------------
-- C2. reactivate_user: same authority rules as deactivation (0026) —
--     platform admin, or user.deactivate over the target's entire footprint,
--     and only on targets ranked strictly below the caller.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION reactivate_user(p_target UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE b UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_platform_admin() THEN
    IF user_max_rank(p_target) >= user_max_rank(auth.uid()) THEN
      RAISE EXCEPTION 'You cannot reactivate someone at or above your own level.'
        USING ERRCODE = '42501';
    END IF;
    FOR b IN SELECT * FROM user_footprint_buildings(p_target) LOOP
      IF NOT user_can(b, 'user.deactivate') THEN
        RAISE EXCEPTION 'That person belongs to a building you do not manage.'
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  UPDATE profiles SET status = 'active' WHERE id = p_target AND status = 'inactive';
END;
$$;

GRANT EXECUTE ON FUNCTION reactivate_user TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   -- 1. As a self-registered org admin (app console):
--   --    supabase.from('org_buildings').insert({org_id: <their org>, building_id: <someone else's building>})
--   --    expect: RLS violation.
--   -- 2. Linking their OWN building (created via Buildings page) still works.
--   -- 3. As a non-admin: supabase.rpc('reactivate_user', {p_target: '<uuid>'})
--   --    expect: permission error.
-- ============================================================
