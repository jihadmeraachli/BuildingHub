-- ============================================================
-- 0047_policy_recursion_fix.sql
-- Bug: "infinite recursion detected in policy for relation buildings" when a
-- compound admin creates a block.
--
-- Cause: two recent policies used DIRECT cross-table subqueries instead of
-- SECURITY DEFINER helpers (the v3 convention that keeps policy evaluation
-- from chaining):
--   * buildings/compounds/organizations INSERT self-service (0031) peeks at
--     profiles;
--   * profiles_select_v3 (0039) peeks back at buildings (compound-grant arm).
-- Policy expansion: buildings → profiles → buildings → … boom.
--
-- Fix: wrap both checks in SECURITY DEFINER functions (definer bodies bypass
-- RLS, so expansion stops at the function boundary). Semantics identical.
--
-- Additive & idempotent. Transactional.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Sealed helper: "is the caller an active profile?"
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_active_profile()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status = 'active');
$$;

DROP POLICY IF EXISTS "buildings_insert_self_service" ON buildings;
CREATE POLICY "buildings_insert_self_service" ON buildings
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR is_active_profile());

DROP POLICY IF EXISTS "compounds_insert_self_service" ON compounds;
CREATE POLICY "compounds_insert_self_service" ON compounds
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR is_active_profile());

DROP POLICY IF EXISTS "organizations_insert_self_service" ON organizations;
CREATE POLICY "organizations_insert_self_service" ON organizations
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR is_active_profile());

-- ------------------------------------------------------------
-- 2. Sealed helper: "may the caller see this profile?" (0039 logic, verbatim)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION can_view_profile(p_profile UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    p_profile = auth.uid()
    OR is_platform_admin()
    OR EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = p_profile
          AND p.building_id IS NOT NULL
          AND user_can(p.building_id, 'resident.manage')
      )
    OR EXISTS (
        SELECT 1 FROM memberships m
        JOIN units un ON un.id = m.unit_id
        WHERE m.user_id = p_profile
          AND m.ended_at IS NULL
          AND user_can(un.building_id, 'resident.manage')
      )
    OR EXISTS (
        SELECT 1 FROM grants g
        WHERE g.user_id = p_profile
          AND (
            (g.building_id IS NOT NULL AND user_can(g.building_id, 'grant.manage'))
            OR (g.compound_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM buildings b
                  WHERE b.compound_id = g.compound_id AND user_can(b.id, 'grant.manage')))
            OR (g.org_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM org_buildings ob
                  WHERE ob.org_id = g.org_id AND user_can(ob.building_id, 'grant.manage')))
          )
      );
$$;

DROP POLICY IF EXISTS "profiles_select_v3" ON profiles;
CREATE POLICY "profiles_select_v3" ON profiles
  FOR SELECT TO authenticated USING (can_view_profile(id));

COMMIT;

-- ============================================================
-- Post-run checks:
--   1. As the compound admin: Buildings → add block → succeeds.
--   2. As an org admin: People still lists their residents (0039 behavior kept).
--   3. As a resident: Settings loads (own profile visible).
-- ============================================================
