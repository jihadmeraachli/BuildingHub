-- ============================================================
-- 0074_issue_units.sql
-- Private per-unit issues (#49 + #58, Jey's design): an issue is logged
-- either for the COMMON AREA or for a specific UNIT the reporter belongs to.
--
-- Visibility (the whole point):
--   managers (issue.view_all)  -> everything, unchanged
--   residents                  -> common-area issues of their building
--                                 + issues on their own units
--                                 + anything they reported themselves
--   Another owner's apartment issue never reaches you - enforced HERE,
--   not by a client filter.
--
-- Logging: a resident can only log for the common area of their building
-- or for a unit they hold an ACTIVE membership on (ended_at IS NULL).
-- Managers can log for any unit in their scope (the natour files on
-- behalf of people).
--
-- Backfill: legacy issues that carried an apartment_number matching
-- exactly one unit label attach to that unit, so old apartment issues do
-- NOT suddenly become building-visible "common" issues.
--
-- Legacy current_user_role()/current_user_building() clauses from 0007 are
-- dropped: 0028 backfilled every legacy role into grants and super_admins
-- were promoted to platform admins, so user_can() covers them all.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE issues ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS issues_unit_idx ON issues(unit_id);

-- Active membership on a specific unit (user_unit_ids() from 0002 predates
-- move-outs and would let a former tenant keep watching the unit's issues).
CREATE OR REPLACE FUNCTION user_member_unit(p_unit UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE unit_id = p_unit AND user_id = auth.uid() AND ended_at IS NULL
  );
$$;
GRANT EXECUTE ON FUNCTION user_member_unit(UUID) TO authenticated;

-- Backfill only where the apartment label resolves to exactly ONE unit.
UPDATE issues i
SET unit_id = (
  SELECT u.id FROM units u
  WHERE u.building_id = i.building_id AND u.label = i.apartment_number
)
WHERE i.unit_id IS NULL
  AND i.apartment_number IS NOT NULL
  AND (
    SELECT count(*) FROM units u
    WHERE u.building_id = i.building_id AND u.label = i.apartment_number
  ) = 1;

DROP POLICY IF EXISTS "issues_select" ON issues;
CREATE POLICY "issues_select" ON issues FOR SELECT USING (
  is_platform_admin()
  OR user_can(building_id, 'issue.view_all')
  OR reported_by = auth.uid()
  OR (unit_id IS NULL AND user_member_building(building_id))
  OR (unit_id IS NOT NULL AND user_member_unit(unit_id))
);

DROP POLICY IF EXISTS "issues_insert" ON issues;
CREATE POLICY "issues_insert" ON issues FOR INSERT WITH CHECK (
  reported_by = auth.uid()
  AND (
    is_platform_admin()
    OR user_can(building_id, 'issue.update')
    OR (user_member_building(building_id) AND (unit_id IS NULL OR user_member_unit(unit_id)))
  )
);

DROP POLICY IF EXISTS "issues_update" ON issues;
CREATE POLICY "issues_update" ON issues FOR UPDATE USING (
  is_platform_admin()
  OR user_can(building_id, 'issue.update')
  OR reported_by = auth.uid()
);

DROP POLICY IF EXISTS "issues_delete" ON issues;
CREATE POLICY "issues_delete" ON issues FOR DELETE USING (
  is_platform_admin()
  OR user_can(building_id, 'issue.update')
);

COMMIT;

-- Post-run checks:
--   1. As resident A: SELECT * FROM issues -> common issues of their building
--      + their own units' issues; resident B's apartment issue absent.
--   2. As resident A: INSERT with unit_id of resident B's unit -> denied.
--   3. As resident A: INSERT with unit_id NULL (their building) -> ok.
--   4. As a manager: everything still visible; INSERT for any unit -> ok.
