-- ============================================================
-- 0112_amenities.sql
-- Amenities: one row per lift, generator, tank, gate, parking, store room.
--
-- WHY. The same equipment was described in three lists that did not know
-- about each other — inspections.category, service_contracts.service and
-- expenses.category — so "everything about the generator" could not be
-- asked: the contract, the inspection history, the fuel expenses and the
-- issues residents raised were four unrelated piles.
-- (Binayati review, 23 Aug 2026, F4.)
--
-- WHAT. An amenity is a named physical thing with a kind, an install date, a
-- cost and an expected life. Inspections, contracts, expenses and issues get
-- an OPTIONAL amenity_id. The enums stay (they still classify rows that have
-- no amenity); the row is what joins them. Cost + install date + expected
-- life give replacement planning for free: "installed 2019, lasts ~10 years".
--
-- Residents can read amenities (user_sees_*): it is the building's inventory.
-- Only building.manage writes.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS amenities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id         UUID REFERENCES buildings(id) ON DELETE CASCADE,
  compound_id         UUID REFERENCES compounds(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN
                        ('elevator','generator','water_tank','water_pump','solar','hvac',
                         'fire_safety','gate','intercom','parking','storage','roof','other')),
  name                TEXT NOT NULL,                 -- "Lift A", "Generator 250kVA"
  location            TEXT,                          -- "Block B, basement"
  install_date        DATE,
  cost_usd            NUMERIC(12,2) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  expected_life_years INT CHECK (expected_life_years IS NULL OR expected_life_years > 0),
  notes               TEXT,
  attachment_url      TEXT,
  active              BOOLEAN NOT NULL DEFAULT TRUE, -- retired kit stays for history
  created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT amenities_scope CHECK ((building_id IS NOT NULL) <> (compound_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS amenities_building_idx ON amenities(building_id, kind);
CREATE INDEX IF NOT EXISTS amenities_compound_idx ON amenities(compound_id, kind);

ALTER TABLE inspections       ADD COLUMN IF NOT EXISTS amenity_id UUID REFERENCES amenities(id) ON DELETE SET NULL;
ALTER TABLE service_contracts ADD COLUMN IF NOT EXISTS amenity_id UUID REFERENCES amenities(id) ON DELETE SET NULL;
ALTER TABLE expenses          ADD COLUMN IF NOT EXISTS amenity_id UUID REFERENCES amenities(id) ON DELETE SET NULL;
ALTER TABLE issues            ADD COLUMN IF NOT EXISTS amenity_id UUID REFERENCES amenities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS inspections_amenity_idx ON inspections(amenity_id) WHERE amenity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contracts_amenity_idx   ON service_contracts(amenity_id) WHERE amenity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS expenses_amenity_idx    ON expenses(amenity_id) WHERE amenity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS issues_amenity_idx      ON issues(amenity_id) WHERE amenity_id IS NOT NULL;

ALTER TABLE amenities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS amenities_select ON amenities;
CREATE POLICY amenities_select ON amenities FOR SELECT USING (
  (building_id IS NOT NULL AND user_sees_building(building_id))
  OR (compound_id IS NOT NULL AND user_sees_compound(compound_id))
);
DROP POLICY IF EXISTS amenities_write ON amenities;
CREATE POLICY amenities_write ON amenities FOR ALL USING (
  (building_id IS NOT NULL AND user_can(building_id, 'building.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = amenities.compound_id
          AND user_can(b.id, 'building.manage')))
) WITH CHECK (
  (building_id IS NOT NULL AND user_can(building_id, 'building.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = amenities.compound_id
          AND user_can(b.id, 'building.manage')))
);

COMMIT;

-- Post-run checks:
--   1. As an admin: add "Lift A" (elevator, installed 2019, 10 years). Tag a
--      contract, an inspection and an expense to it. The Amenities page shows
--      all three under Lift A, and "replace around 2029".
--   2. As a resident: the list is visible; no Add button; INSERT → 42501.
--   3. node scripts/rls-audit.mjs (amenities added).
