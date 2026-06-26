-- ============================================================
-- BuildingHub — compound-level inspections & contracts
-- A record can target a whole COMPOUND (e.g. main gate inspection,
-- compound landscaping contract) or a single BLOCK. Safe to re-run.
-- ============================================================

-- ---- inspections ----
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS compound_id UUID REFERENCES compounds(id) ON DELETE CASCADE;
ALTER TABLE inspections ALTER COLUMN building_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS inspections_compound_idx ON inspections(compound_id);

DROP POLICY IF EXISTS inspections_select ON inspections;
DROP POLICY IF EXISTS inspections_write ON inspections;
CREATE POLICY inspections_select ON inspections FOR SELECT USING (
  (building_id IS NOT NULL AND (user_can(building_id,'finance.view') OR user_can(building_id,'building.manage') OR user_member_building(building_id)))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = inspections.compound_id
          AND (user_can(b.id,'building.manage') OR user_can(b.id,'finance.view') OR user_member_building(b.id))))
);
CREATE POLICY inspections_write ON inspections FOR ALL USING (
  (building_id IS NOT NULL AND user_can(building_id,'building.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = inspections.compound_id AND user_can(b.id,'building.manage')))
) WITH CHECK (
  (building_id IS NOT NULL AND user_can(building_id,'building.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = inspections.compound_id AND user_can(b.id,'building.manage')))
);

-- ---- service_contracts ----
ALTER TABLE service_contracts ADD COLUMN IF NOT EXISTS compound_id UUID REFERENCES compounds(id) ON DELETE CASCADE;
ALTER TABLE service_contracts ALTER COLUMN building_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS contracts_compound_idx ON service_contracts(compound_id);

DROP POLICY IF EXISTS contracts_select ON service_contracts;
DROP POLICY IF EXISTS contracts_write ON service_contracts;
CREATE POLICY contracts_select ON service_contracts FOR SELECT USING (
  (building_id IS NOT NULL AND (user_can(building_id,'finance.view') OR user_can(building_id,'building.manage') OR user_member_building(building_id)))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = service_contracts.compound_id
          AND (user_can(b.id,'building.manage') OR user_can(b.id,'finance.view') OR user_member_building(b.id))))
);
CREATE POLICY contracts_write ON service_contracts FOR ALL USING (
  (building_id IS NOT NULL AND user_can(building_id,'building.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = service_contracts.compound_id AND user_can(b.id,'building.manage')))
) WITH CHECK (
  (building_id IS NOT NULL AND user_can(building_id,'building.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = service_contracts.compound_id AND user_can(b.id,'building.manage')))
);
