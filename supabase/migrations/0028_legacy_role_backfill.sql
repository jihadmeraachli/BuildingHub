-- ============================================================
-- 0028_legacy_role_backfill.sql
-- "Make grants tell the truth."
--
-- Two problems this fixes:
--
-- 1. LEGACY ADMINS HAVE NO GRANTS.
--    v2 stored management access in profiles.role ('building_admin' +
--    profiles.building_id). v3 moved it to `grants`, and the CODE stopped
--    reading profiles.role for permissions — but the DATA was never migrated.
--    Result: people shown as "Building Admin" in People have NO grants row, so
--      * user_can() denies them everything (RLS routes through grants only), and
--      * the 0026 anti-orphan guard can't see them as an admin, so deactivating
--        a building's "only admin" silently orphaned it.
--    This backfills a building_admin grant for them. PREVIEW FIRST (below).
--
-- 2. COMPOUND ADMINS GET NO NOTIFICATIONS.
--    building_admin_ids() (0009) unions building-scope + org-scope grants but
--    predates 0027's compound scope — so a compound_admin was never notified.
--
-- Additive & idempotent. Transactional.
-- ============================================================

-- ------------------------------------------------------------
-- PREVIEW (run this on its own BEFORE the migration — read-only).
-- It lists exactly who would receive a grant, and for which building:
--
--   SELECT p.full_name, p.role AS legacy_role, b.name AS building, p.status
--   FROM profiles p
--   JOIN buildings b ON b.id = p.building_id
--   WHERE p.status = 'active'
--     AND p.role = 'building_admin'
--     AND p.building_id IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM grants g WHERE g.user_id = p.id)
--   ORDER BY b.name, p.full_name;
--
-- If anyone in that list should NOT be an admin, fix profiles.role first
-- (or revoke their grant in People → Access afterwards).
-- ------------------------------------------------------------

BEGIN;

-- ------------------------------------------------------------
-- 1. Backfill: legacy building_admin -> a real building-scoped grant.
--    Only for ACTIVE profiles that have NO grants at all, so we never
--    duplicate or downgrade existing v3 access.
-- ------------------------------------------------------------
INSERT INTO grants (user_id, scope_type, building_id, org_id, compound_id, role)
SELECT p.id, 'building', p.building_id, NULL, NULL, 'building_admin'
FROM profiles p
WHERE p.status = 'active'
  AND p.role = 'building_admin'
  AND p.building_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM grants g WHERE g.user_id = p.id)
  -- belt & braces: never create a duplicate for the same person+building
  AND NOT EXISTS (
    SELECT 1 FROM grants g
    WHERE g.user_id = p.id AND g.scope_type = 'building' AND g.building_id = p.building_id
  );

-- NOTE: legacy 'super_admin' is deliberately NOT backfilled — those accounts
-- were already promoted to profiles.is_platform_admin (see HANDOFF), and
-- is_platform_admin() short-circuits user_can() anyway.

-- ------------------------------------------------------------
-- 2. Notification recipients must know about compound scope (0027 gap).
--    Without this a compound_admin never gets notified about their own blocks.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION building_admin_ids(p_building UUID)
RETURNS TABLE(uid UUID) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT g.user_id FROM grants g
    WHERE g.scope_type = 'building' AND g.building_id = p_building
  UNION
  -- compound grants cover every block in the compound (0027)
  SELECT g.user_id FROM grants g JOIN buildings b ON b.compound_id = g.compound_id
    WHERE g.scope_type = 'compound' AND b.id = p_building
  UNION
  SELECT g.user_id FROM grants g JOIN org_buildings ob ON ob.org_id = g.org_id
    WHERE g.scope_type = 'org' AND ob.building_id = p_building
  UNION
  SELECT p.id FROM profiles p WHERE p.is_platform_admin
  UNION
  SELECT p.id FROM profiles p WHERE p.role = 'super_admin'
  UNION
  SELECT p.id FROM profiles p WHERE p.role = 'building_admin' AND p.building_id = p_building;
$$;

COMMIT;

-- ------------------------------------------------------------
-- Post-run checks (read-only):
--
--   -- nobody is left showing as an admin without real access:
--   SELECT p.full_name, p.role AS legacy_role, p.status
--   FROM profiles p
--   WHERE p.status = 'active' AND p.role = 'building_admin'
--     AND NOT EXISTS (SELECT 1 FROM grants g WHERE g.user_id = p.id);
--   -- expect: 0 rows
--
--   -- what the backfill created:
--   SELECT pr.full_name, b.name AS building, g.role, g.scope_type, g.created_at
--   FROM grants g
--   JOIN profiles pr ON pr.id = g.user_id
--   JOIN buildings b ON b.id = g.building_id
--   WHERE g.scope_type = 'building'
--   ORDER BY g.created_at DESC;
-- ------------------------------------------------------------
