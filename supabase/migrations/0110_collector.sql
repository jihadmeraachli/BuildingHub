-- ============================================================
-- 0110_collector.sql
-- The collector: a login for the person who takes the cash.
--
-- WHY. In most Lebanese buildings the natour or a committee member goes door
-- to door and collects. Our role ladder assumed everyone who touches money
-- sees the book. A collector should be able to RECORD a payment and nothing
-- else: no expenses, no balances, no statements, no other people's receipts.
-- (Binayati review, 23 Aug 2026, F5.)
--
-- WHAT.
--   role 'building_collector'  capability: payment.record, and only that.
--   rank 30                    above viewer (20), below finance (40): an
--                              admin can manage a collector, a collector
--                              cannot manage anyone (no grant.manage anyway).
--   units_select               a collector must see the units to pick one.
--   payments_select            a collector sees the payments THEY recorded
--                              (recorded_by = auth.uid()), so the receipt they
--                              just wrote is there to check, and nobody else's.
--
-- No change to payments_write: it is already gated on payment.record, which
-- is exactly what the role holds. Voiding is a separate path and stays with
-- finance. Keep src/lib/permissions.ts in sync (it mirrors role_has_cap).
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE grants DROP CONSTRAINT IF EXISTS grants_role_check;
ALTER TABLE grants ADD  CONSTRAINT grants_role_check
  CHECK (role IN ('org_admin','org_finance',
                  'compound_admin','compound_finance',
                  'building_admin','building_finance','building_super','building_collector',
                  'viewer'));

CREATE OR REPLACE FUNCTION role_rank(p_role TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role
    WHEN 'org_admin'          THEN 80
    WHEN 'compound_admin'     THEN 70
    WHEN 'building_admin'     THEN 60
    WHEN 'building_super'     THEN 50
    WHEN 'org_finance'        THEN 40
    WHEN 'compound_finance'   THEN 40
    WHEN 'building_finance'   THEN 40
    WHEN 'building_collector' THEN 30
    WHEN 'viewer'             THEN 20
    ELSE 0
  END;
$$;

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
    WHEN p_role IN ('building_finance','org_finance','compound_finance') THEN p_cap IN (
      'expense.manage','charge.manage','payment.record','payment.confirm','finance.view')
    WHEN p_role = 'building_super' THEN p_cap IN (
      'issue.view_all','issue.update','meeting.manage')
    -- the collector: writes receipts, sees nothing else (0110)
    WHEN p_role = 'building_collector' THEN p_cap IN ('payment.record')
    WHEN p_role = 'viewer' THEN p_cap IN ('finance.view','issue.view_all')
    ELSE FALSE
  END;
$$;

-- a collector needs the unit list to pick from
DROP POLICY IF EXISTS units_select ON units;
CREATE POLICY units_select ON units FOR SELECT USING (
  user_can(building_id, 'finance.view')
  OR user_can(building_id, 'building.manage')
  OR user_can(building_id, 'payment.record')
  OR user_member_building(building_id)
);

-- … and sees the receipts they wrote, nobody else's (0097 scoping preserved)
DROP POLICY IF EXISTS payments_select ON payments;
CREATE POLICY payments_select ON payments FOR SELECT USING (
  user_can(building_id, 'finance.view')
  OR recorded_by = auth.uid()
  OR user_owns_unit(unit_id)
  OR (user_tenants_unit(unit_id)
      AND paid_by = 'tenant'
      AND (tenant_id = auth.uid() OR tenant_id IS NULL))
);

COMMIT;

-- Post-run checks:
--   1. Grant someone building_collector from Security. As them: /collect lists
--      the units, a payment saves, it appears under "my collections"; Finance,
--      Reports and Dues are not in the nav and /finance shows nothing.
--   2. As that collector (app console): supabase.from('charges').select('*')
--      → zero rows; supabase.from('payments').select('*') → only their own.
--   3. node scripts/rls-audit.mjs with a collector persona added.
