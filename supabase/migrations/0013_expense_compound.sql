-- ============================================================
-- BuildingHub — compound-level expenses
-- An expense can target a whole COMPOUND (shared across all blocks)
-- or a single BLOCK. Charges still carry each unit's block_id, so the
-- compound book slices by block automatically. Safe to re-run.
-- ============================================================

-- a compound-shared expense has compound_id set + building_id null
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS compound_id UUID REFERENCES compounds(id) ON DELETE CASCADE;

-- building_id becomes optional (null for compound-wide / cross-block expenses)
ALTER TABLE expenses ALTER COLUMN building_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS expenses_compound_idx ON expenses(compound_id);

-- RLS: managers of ANY block in the compound can read/write compound-level expenses.
-- (existing per-building policies still cover block-scoped rows.)
DROP POLICY IF EXISTS expenses_select ON expenses;
DROP POLICY IF EXISTS expenses_write ON expenses;

CREATE POLICY expenses_select ON expenses FOR SELECT USING (
  (building_id IS NOT NULL AND user_can(building_id, 'finance.view'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = expenses.compound_id
          AND user_can(b.id, 'finance.view')))
);

CREATE POLICY expenses_write ON expenses FOR ALL USING (
  (building_id IS NOT NULL AND user_can(building_id, 'expense.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = expenses.compound_id
          AND user_can(b.id, 'expense.manage')))
) WITH CHECK (
  (building_id IS NOT NULL AND user_can(building_id, 'expense.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = expenses.compound_id
          AND user_can(b.id, 'expense.manage')))
);
