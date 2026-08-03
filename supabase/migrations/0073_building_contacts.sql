-- ============================================================
-- 0073_building_contacts.sql
-- Building directory (#59): "who do I call?" — committee leader, natour,
-- electrician, plumber, the moteur guy. Fully DYNAMIC (Jey's call): the
-- admin adds rows with a free-text title + name + phone; no preset enum,
-- so no migration when a new trade appears. A contact belongs to a block
-- OR to the whole compound (same shape as service_contracts, 0014).
--
-- Read:  anyone with a grant that can see the building (building.manage /
--        finance.view / issue.view_all — the natour must see the list too)
--        + residents of the building / compound (user_member_building).
-- Write: building.manage only.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS building_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id UUID REFERENCES buildings(id) ON DELETE CASCADE,
  compound_id UUID REFERENCES compounds(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT building_contacts_scope CHECK (building_id IS NOT NULL OR compound_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS building_contacts_building_idx ON building_contacts(building_id);
CREATE INDEX IF NOT EXISTS building_contacts_compound_idx ON building_contacts(compound_id);

ALTER TABLE building_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS building_contacts_select ON building_contacts;
CREATE POLICY building_contacts_select ON building_contacts FOR SELECT USING (
  (building_id IS NOT NULL AND (
    user_can(building_id,'building.manage') OR user_can(building_id,'finance.view')
    OR user_can(building_id,'issue.view_all') OR user_member_building(building_id)))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = building_contacts.compound_id
          AND (user_can(b.id,'building.manage') OR user_can(b.id,'finance.view')
               OR user_can(b.id,'issue.view_all') OR user_member_building(b.id))))
);

DROP POLICY IF EXISTS building_contacts_write ON building_contacts;
CREATE POLICY building_contacts_write ON building_contacts FOR ALL USING (
  (building_id IS NOT NULL AND user_can(building_id,'building.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = building_contacts.compound_id
          AND user_can(b.id,'building.manage')))
) WITH CHECK (
  (building_id IS NOT NULL AND user_can(building_id,'building.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = building_contacts.compound_id
          AND user_can(b.id,'building.manage')))
);

COMMIT;

-- Post-run checks:
--   1. As a building admin: INSERT a contact → ok; as a viewer/resident → denied.
--   2. As a resident of the building: SELECT → rows visible (incl. compound-level).
--   3. As an unrelated user: SELECT → zero rows.
