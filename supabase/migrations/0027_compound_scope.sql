-- ============================================================
-- 0027_compound_scope.sql
-- "The compound is the management unit, not the block."
--
-- Until now grants could only be scoped to an ORG or a single BUILDING (block).
-- That meant running a 5-block compound needed 5 separate grants — and adding
-- Block F later silently left it uncovered (an orphaning bug waiting to happen).
-- Every other page already thinks compound-first (useEntities); People didn't.
--
-- Adds:
--   1. grants.scope_type = 'compound' + grants.compound_id.
--   2. Roles: compound_admin (70), compound_finance (40), building_super (50).
--        compound_admin   — runs the whole compound, ALL blocks incl. future ones
--        compound_finance — the compound's book across all blocks
--        building_super   — the ناطور: issues + inspections, NEVER sees money
--   3. user_can() cascades compound → its blocks (buildings.compound_id).
--   4. The 0026 anti-orphan helpers now count compound_admins, so a block with
--      a compound admin over it is correctly NOT considered orphaned.
--
-- Ladder: platform(100) > org_admin(80) > compound_admin(70) >
--         building_admin(60) > building_super(50) > finance(40) > viewer(20)
--
-- Additive & idempotent. Transactional: any failure rolls the whole thing back.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Schema: compound-scoped grants
-- ------------------------------------------------------------
ALTER TABLE grants ADD COLUMN IF NOT EXISTS compound_id UUID REFERENCES compounds(id) ON DELETE CASCADE;

-- widen scope_type
ALTER TABLE grants DROP CONSTRAINT IF EXISTS grants_scope_type_check;
ALTER TABLE grants ADD  CONSTRAINT grants_scope_type_check
  CHECK (scope_type IN ('org','compound','building'));

-- widen roles
ALTER TABLE grants DROP CONSTRAINT IF EXISTS grants_role_check;
ALTER TABLE grants ADD  CONSTRAINT grants_role_check
  CHECK (role IN ('org_admin','org_finance',
                  'compound_admin','compound_finance',
                  'building_admin','building_finance','building_super',
                  'viewer'));

-- exactly one scope id must be set, matching scope_type
ALTER TABLE grants DROP CONSTRAINT IF EXISTS grants_scope_chk;
ALTER TABLE grants ADD  CONSTRAINT grants_scope_chk CHECK (
  (scope_type = 'org'      AND org_id      IS NOT NULL AND compound_id IS NULL AND building_id IS NULL) OR
  (scope_type = 'compound' AND compound_id IS NOT NULL AND org_id      IS NULL AND building_id IS NULL) OR
  (scope_type = 'building' AND building_id IS NOT NULL AND org_id      IS NULL AND compound_id IS NULL)
);

CREATE INDEX IF NOT EXISTS grants_compound_idx ON grants(compound_id);

-- ------------------------------------------------------------
-- 2. Ladder
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION role_rank(p_role TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role
    WHEN 'org_admin'        THEN 80
    WHEN 'compound_admin'   THEN 70
    WHEN 'building_admin'   THEN 60
    WHEN 'building_super'   THEN 50
    WHEN 'org_finance'      THEN 40
    WHEN 'compound_finance' THEN 40
    WHEN 'building_finance' THEN 40
    WHEN 'viewer'           THEN 20
    ELSE 0
  END;
$$;

-- ------------------------------------------------------------
-- 3. Capabilities.  KEEP IN SYNC with src/lib/permissions.ts
--    compound_admin == building_admin's powers, applied to every block.
--    building_super deliberately has NO finance capability of any kind.
--    'user.delete' remains in NO role (platform admin only).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION role_has_cap(p_role TEXT, p_cap TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_role = 'org_admin' THEN p_cap IN (
      'building.manage','unit.manage','group.manage',
      'resident.approve','resident.manage','grant.manage',
      'issue.view_all','issue.update',
      'expense.manage','charge.manage','payment.record','payment.confirm','finance.view',
      'meeting.manage','org.manage','org.assign_buildings',
      'user.deactivate')
    WHEN p_role IN ('compound_admin','building_admin') THEN p_cap IN (
      'building.manage','unit.manage','group.manage',
      'resident.approve','resident.manage','grant.manage',
      'issue.view_all','issue.update',
      'expense.manage','charge.manage','payment.record','payment.confirm','finance.view',
      'meeting.manage',
      'user.deactivate')
      -- ✗ org.manage  ✗ org.assign_buildings  (org-level only)
    WHEN p_role IN ('building_finance','org_finance','compound_finance') THEN p_cap IN (
      'expense.manage','charge.manage','payment.record','payment.confirm','finance.view')
    WHEN p_role = 'building_super' THEN p_cap IN (
      'issue.view_all','issue.update','meeting.manage')
      -- ✗ anything touching money, grants, residents or structure
    WHEN p_role = 'viewer' THEN p_cap IN ('finance.view','issue.view_all')
    ELSE FALSE
  END;
$$;

-- ------------------------------------------------------------
-- 4. THE permission check — now cascades compound → its blocks.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION user_can(p_building UUID, p_cap TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE r TEXT;
BEGIN
  IF is_platform_admin() THEN RETURN TRUE; END IF;
  FOR r IN
    SELECT g.role FROM grants g
    WHERE g.user_id = auth.uid()
      AND (
        (g.scope_type = 'building' AND g.building_id = p_building)
        -- a compound grant covers every block in that compound, including
        -- blocks added AFTER the grant was made.
        OR (g.scope_type = 'compound' AND EXISTS (
              SELECT 1 FROM buildings b
              WHERE b.id = p_building AND b.compound_id = g.compound_id))
        OR (g.scope_type = 'org' AND EXISTS (
              SELECT 1 FROM org_buildings ob
              WHERE ob.org_id = g.org_id AND ob.building_id = p_building))
      )
  LOOP
    IF role_has_cap(r, p_cap) THEN RETURN TRUE; END IF;
  END LOOP;
  RETURN FALSE;
END;
$$;

-- ------------------------------------------------------------
-- 5. Teach the 0026 guards about compound scope.
--    Without this, a block whose only admin is a COMPOUND admin would look
--    orphaned (and a compound admin would be invisible to the last-admin check).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION user_admins_building(p_user UUID, p_building UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM grants g
    WHERE g.user_id = p_user
      AND g.role IN ('building_admin','compound_admin','org_admin')
      AND (
        (g.scope_type = 'building' AND g.building_id = p_building)
        OR (g.scope_type = 'compound' AND EXISTS (
              SELECT 1 FROM buildings b
              WHERE b.id = p_building AND b.compound_id = g.compound_id))
        OR (g.scope_type = 'org' AND EXISTS (
              SELECT 1 FROM org_buildings ob
              WHERE ob.org_id = g.org_id AND ob.building_id = p_building))
      )
  );
$$;

CREATE OR REPLACE FUNCTION building_active_admin_count(p_building UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COUNT(DISTINCT g.user_id)::INT
  FROM grants g JOIN profiles p ON p.id = g.user_id
  WHERE p.status = 'active'
    AND g.role IN ('building_admin','compound_admin','org_admin')
    AND (
      (g.scope_type = 'building' AND g.building_id = p_building)
      OR (g.scope_type = 'compound' AND EXISTS (
            SELECT 1 FROM buildings b
            WHERE b.id = p_building AND b.compound_id = g.compound_id))
      OR (g.scope_type = 'org' AND EXISTS (
            SELECT 1 FROM org_buildings ob
            WHERE ob.org_id = g.org_id AND ob.building_id = p_building))
    );
$$;

CREATE OR REPLACE FUNCTION user_footprint_buildings(p_user UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT DISTINCT b FROM (
    SELECT u.building_id AS b
      FROM memberships m JOIN units u ON u.id = m.unit_id
      WHERE m.user_id = p_user AND m.ended_at IS NULL
    UNION
    SELECT g.building_id
      FROM grants g
      WHERE g.user_id = p_user AND g.scope_type = 'building'
    UNION
    SELECT bl.id
      FROM grants g JOIN buildings bl ON bl.compound_id = g.compound_id
      WHERE g.user_id = p_user AND g.scope_type = 'compound'
    UNION
    SELECT ob.building_id
      FROM grants g JOIN org_buildings ob ON ob.org_id = g.org_id
      WHERE g.user_id = p_user AND g.scope_type = 'org'
  ) s WHERE b IS NOT NULL;
$$;

COMMIT;

-- ------------------------------------------------------------
-- Post-run sanity checks (read-only, run separately):
--
--   SELECT role_rank('org_admin')      > role_rank('compound_admin') AS ok1,
--          role_rank('compound_admin') > role_rank('building_admin') AS ok2,
--          role_rank('building_admin') > role_rank('building_super') AS ok3;
--
--   -- the ناطور must never see money:
--   SELECT role_has_cap('building_super','finance.view')   AS must_be_false,
--          role_has_cap('building_super','payment.record') AS must_be_false2,
--          role_has_cap('building_super','issue.update')   AS must_be_true;
--
--   -- compound admin behaves like a building admin, minus org powers:
--   SELECT role_has_cap('compound_admin','expense.manage') AS must_be_true,
--          role_has_cap('compound_admin','org.manage')     AS must_be_false;
-- ------------------------------------------------------------
