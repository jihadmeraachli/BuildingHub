-- ============================================================
-- BuildingHub — let residents VIEW service contracts for their
-- building (read-only). Managers keep full write access.
-- (Inspections already allow member reads.) Safe to re-run.
-- ============================================================
DROP POLICY IF EXISTS contracts_select ON service_contracts;
CREATE POLICY contracts_select ON service_contracts FOR SELECT USING (
  user_can(building_id, 'finance.view')
  OR user_can(building_id, 'building.manage')
  OR user_member_building(building_id)
);
