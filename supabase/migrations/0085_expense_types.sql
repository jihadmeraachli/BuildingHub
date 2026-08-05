-- ============================================================
-- 0085_expense_types.sql
-- Expense types become DATA, not an enum — the precursor to the Prepaid Budget
-- rework (expert session, 2026-08-05).
--
-- The admin gets full control of the catalog: as many types as the building
-- needs (fuel, gardening, elevator maintenance, …), managed from the building
-- settings. Expenses select from them, budget lines are built from them, and
-- the metering module hangs off the ones flagged `is_metered`
-- (generator/water). Budget-vs-actual reporting joins the two sides on the
-- type, which is why free-text categories were never going to work.
--
-- COMPATIBILITY. expenses.category keeps its CHECK and stays populated: seeded
-- types carry a `key` matching the legacy enum, and an expense with a custom
-- type writes category='other' + the type id. Nothing that reads `category`
-- breaks; everything new reads `expense_type_id`.
--
-- Scope mirrors dues_plans: building XOR compound, the compound governing its
-- blocks like billing_mode does. Every existing building/compound is seeded
-- with the 7 legacy categories, and a trigger seeds new ones on creation —
-- "when setting up the building".
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS expense_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id UUID REFERENCES buildings(id) ON DELETE CASCADE,
  compound_id UUID REFERENCES compounds(id) ON DELETE CASCADE,
  -- legacy enum value for seeded rows ('water', 'electricity', …); NULL = custom
  key         TEXT,
  name        TEXT NOT NULL,
  -- metered types get the metering module (readings → pro-rata expense)
  is_metered  BOOLEAN NOT NULL DEFAULT FALSE,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT expense_type_scope CHECK ((building_id IS NOT NULL) <> (compound_id IS NOT NULL))
);

-- one name per scope (case-insensitive), so the picker never shows dupes
CREATE UNIQUE INDEX IF NOT EXISTS expense_types_bldg_name_idx
  ON expense_types (building_id, lower(name)) WHERE building_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS expense_types_comp_name_idx
  ON expense_types (compound_id, lower(name)) WHERE compound_id IS NOT NULL;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_type_id UUID REFERENCES expense_types(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS expenses_type_idx ON expense_types(building_id, compound_id);
CREATE INDEX IF NOT EXISTS expenses_expense_type_idx ON expenses(expense_type_id) WHERE expense_type_id IS NOT NULL;

-- ------------------------------------------------------------
-- RLS. Reading a type name is harmless and residents see expense lists (0069),
-- so SELECT follows the same audience; writes need expense.manage.
-- ------------------------------------------------------------
ALTER TABLE expense_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_types_select ON expense_types;
CREATE POLICY expense_types_select ON expense_types FOR SELECT USING (
  is_platform_admin()
  OR (building_id IS NOT NULL AND (
        user_can(building_id, 'finance.view')
        OR EXISTS (SELECT 1 FROM memberships m JOIN units u ON u.id = m.unit_id
                    WHERE u.building_id = expense_types.building_id AND m.user_id = auth.uid())))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b
        WHERE b.compound_id = expense_types.compound_id
          AND (user_can(b.id, 'finance.view')
               OR EXISTS (SELECT 1 FROM memberships m JOIN units u ON u.id = m.unit_id
                           WHERE u.building_id = b.id AND m.user_id = auth.uid()))))
);

DROP POLICY IF EXISTS expense_types_write ON expense_types;
CREATE POLICY expense_types_write ON expense_types FOR ALL USING (
  is_platform_admin()
  OR (building_id IS NOT NULL AND user_can(building_id, 'expense.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b
        WHERE b.compound_id = expense_types.compound_id AND user_can(b.id, 'expense.manage')))
) WITH CHECK (
  is_platform_admin()
  OR (building_id IS NOT NULL AND user_can(building_id, 'expense.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b
        WHERE b.compound_id = expense_types.compound_id AND user_can(b.id, 'expense.manage')))
);

-- ------------------------------------------------------------
-- Seed: the 7 legacy categories, for every existing building and compound.
-- Names match the app's current labels so nothing changes visually.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_expense_types(p_building UUID, p_compound UUID)
RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO expense_types (building_id, compound_id, key, name, sort_order)
  SELECT p_building, p_compound, d.key, d.name, d.sort
  FROM (VALUES
    ('water',           'Water',           10),
    ('electricity',     'Electricity',     20),
    ('common_expenses', 'Common Expenses', 30),
    ('projects',        'Projects',        40),
    ('contracts',       'Contracts',       50),
    ('fines',           'Fines',           60),
    ('other',           'Other',           70)
  ) AS d(key, name, sort)
  WHERE NOT EXISTS (
    SELECT 1 FROM expense_types t
    WHERE t.key = d.key
      AND t.building_id IS NOT DISTINCT FROM p_building
      AND t.compound_id IS NOT DISTINCT FROM p_compound
  );
$$;

SELECT seed_expense_types(b.id, NULL) FROM buildings b;
SELECT seed_expense_types(NULL, c.id) FROM compounds c;

-- new entities arrive with the catalog already in place
CREATE OR REPLACE FUNCTION trg_seed_expense_types() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_TABLE_NAME = 'buildings' THEN PERFORM seed_expense_types(NEW.id, NULL);
  ELSE PERFORM seed_expense_types(NULL, NEW.id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS seed_expense_types_building ON buildings;
CREATE TRIGGER seed_expense_types_building AFTER INSERT ON buildings
  FOR EACH ROW EXECUTE FUNCTION trg_seed_expense_types();
DROP TRIGGER IF EXISTS seed_expense_types_compound ON compounds;
CREATE TRIGGER seed_expense_types_compound AFTER INSERT ON compounds
  FOR EACH ROW EXECUTE FUNCTION trg_seed_expense_types();

-- ------------------------------------------------------------
-- Backfill: existing expenses point at their scope's seeded type.
-- Compound-scoped expenses (building_id NULL) map to the compound's types;
-- block expenses map to the compound's types when the block is in one (the
-- compound governs), else the building's own.
-- ------------------------------------------------------------
UPDATE expenses e
   SET expense_type_id = t.id
  FROM buildings b, expense_types t
 WHERE e.expense_type_id IS NULL
   AND e.building_id = b.id
   AND t.key = e.category
   AND ((b.compound_id IS NOT NULL AND t.compound_id = b.compound_id)
     OR (b.compound_id IS NULL     AND t.building_id = b.id));

UPDATE expenses e
   SET expense_type_id = t.id
  FROM expense_types t
 WHERE e.expense_type_id IS NULL
   AND e.building_id IS NULL
   AND e.compound_id IS NOT NULL
   AND t.compound_id = e.compound_id
   AND t.key = e.category;

COMMIT;

-- ============================================================
-- Post-run checks:
--   SELECT count(*) FROM expense_types;                -- 7 × (buildings + compounds), at least
--   SELECT count(*) FROM expenses WHERE expense_type_id IS NULL;  -- 0
--   Create a building → its 7 types appear without any app code running.
-- ============================================================
