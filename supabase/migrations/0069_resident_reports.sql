-- ============================================================
-- 0069_resident_reports.sql
-- Expense transparency for residents (#62 part 2, Jey's product decision:
-- DEFAULT ON): building members can READ the expense list of their own
-- building (and compound-level expenses of their compound). Residents
-- already see their allocated share as charges; this opens the building-wide
-- outgoings list that powers the resident "Building expenses" report.
-- Writes are untouched (expense.manage only). Mirrors 0010's contracts
-- pattern via the sealed helper user_member_building().
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

DROP POLICY IF EXISTS expenses_select ON expenses;

CREATE POLICY expenses_select ON expenses FOR SELECT USING (
  (building_id IS NOT NULL AND user_can(building_id, 'finance.view'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = expenses.compound_id
          AND user_can(b.id, 'finance.view')))
  -- residents: their building's expenses, and their compound's shared expenses
  OR (building_id IS NOT NULL AND user_member_building(building_id))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = expenses.compound_id
          AND user_member_building(b.id)))
);

COMMIT;

-- Post-run checks:
--   1. As a resident: SELECT count(*) FROM expenses → rows for their building.
--   2. As an unrelated user: same → zero rows.
--   3. As a resident: INSERT INTO expenses ... → still denied.
