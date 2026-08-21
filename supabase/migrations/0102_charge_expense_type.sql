-- ============================================================
-- 0102_charge_expense_type.sql
-- A charge remembers which catalog type it came from (2026-08-21).
--
-- THE BUG. 0085 made expense types DATA (a per-building catalog) but charges
-- kept only `category`, the legacy 7-value enum, copied from their expense.
-- A custom type files under 'other', so:
--
--   admin sees   "Gardening"       (resolved through expenses → expense_types)
--   resident sees "Other"          (only has the enum on the charge)
--
-- Same money, same building, two different words, and the resident gets the
-- useless one. docs/REPORTING_GUIDANCE.md names this exact failure as a rule:
-- expense names come from the catalog, never the enum.
--
-- The resident report reads charges directly and cannot join back to expenses,
-- because RLS scopes them to their own units while the expense is building-
-- wide. Denormalising the type onto the charge is the fix that works from
-- both sides.
--
-- BACKFILL is exact, not a guess: every charge already carries expense_id, so
-- the type is looked up rather than inferred. Manual charges (expense_id NULL)
-- keep a NULL type and fall back to the enum, which is correct — they never
-- had a catalog type to lose.
--
-- KEPT IN STEP: a trigger copies the type on insert and on any change of
-- expense, so the two cannot drift the way category and expense_type_id did.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE charges ADD COLUMN IF NOT EXISTS expense_type_id UUID
  REFERENCES expense_types(id) ON DELETE SET NULL;

COMMENT ON COLUMN charges.expense_type_id IS
  'The catalog type (0085) this charge came from, copied off its expense so a resident sees the real name instead of the legacy enum. NULL for manual charges, which fall back to category.';

CREATE INDEX IF NOT EXISTS charges_expense_type_idx
  ON charges (expense_type_id) WHERE expense_type_id IS NOT NULL;

-- ------------------------------------------------------------
-- Backfill from the expense each charge already points at.
-- ------------------------------------------------------------
UPDATE charges c
   SET expense_type_id = e.expense_type_id
  FROM expenses e
 WHERE c.expense_id = e.id
   AND c.expense_type_id IS NULL
   AND e.expense_type_id IS NOT NULL;

-- ------------------------------------------------------------
-- Keep it in step. Fires on INSERT and whenever a charge is re-pointed at a
-- different expense — which the metering re-post does every time it rebuilds
-- its charges (0093).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_charge_expense_type() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.expense_id IS NOT NULL THEN
    SELECT expense_type_id INTO NEW.expense_type_id FROM expenses WHERE id = NEW.expense_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS charge_expense_type ON charges;
CREATE TRIGGER charge_expense_type
  BEFORE INSERT OR UPDATE OF expense_id ON charges
  FOR EACH ROW EXECUTE FUNCTION trg_charge_expense_type();

COMMIT;

-- ============================================================
-- Post-run checks:
--   Every charge that has an expense with a type now has that type:
--     SELECT count(*) FROM charges c JOIN expenses e ON e.id = c.expense_id
--     WHERE e.expense_type_id IS NOT NULL AND c.expense_type_id IS NULL;   -- 0
--
--   Post an expense under a CUSTOM type, then open the resident's Custom
--   report: the charge shows the catalog name, not "Other".
--
--   Manual charges (expense_id NULL) keep expense_type_id NULL and still show
--   their category. That is intended, not a gap.
-- ============================================================
