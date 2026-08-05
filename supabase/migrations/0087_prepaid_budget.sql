-- ============================================================
-- 0087_prepaid_budget.sql
-- Dues become the PREPAID BUDGET (expert session, 2026-08-05).
--
-- The expert's model: there is no standing plan with a magic total. Every
-- issuance IS the plan — the admin builds a budget out of LINES (fuel, common
-- areas, elevator maintenance, gardening… each an expense TYPE from 0085 plus
-- an amount), the total of the lines is what gets split across units by the
-- chosen basis, and the whole thing is TIME-BOUND: a period from → to, so
-- reporting can later hold the budget against the actual expenses booked in
-- that window (budget vs actual, in Reports).
--
-- The dues rows stay exactly what they were — per-unit, per-party obligations
-- with the carry netting of e0dc482 — they just gain a budget_id pointing at
-- the budget that issued them. Everything downstream (reminders, outstanding,
-- statements, the netting rule) keeps working unchanged because the obligation
-- shape did not change, only where its total comes from.
--
-- dues_plans is retired from the UI (kept for history; nothing writes it).
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS budgets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id  UUID REFERENCES buildings(id) ON DELETE CASCADE,
  compound_id  UUID REFERENCES compounds(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  due_date     DATE,
  method       TEXT NOT NULL DEFAULT 'by_shares' CHECK (method IN ('by_shares','equal','custom')),
  billed_to    TEXT NOT NULL DEFAULT 'tenant_where_leased' CHECK (billed_to IN ('tenant_where_leased','owner')),
  -- OFF = a flat ask (6497e48): collect in full even from units in credit
  true_up      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT budget_scope  CHECK ((building_id IS NOT NULL) <> (compound_id IS NOT NULL)),
  CONSTRAINT budget_period CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS budget_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id       UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  expense_type_id UUID REFERENCES expense_types(id) ON DELETE SET NULL,
  note            TEXT,
  -- canonical USD, with the LBP log alongside (0086 semantics)
  amount_usd      NUMERIC(12,2) NOT NULL,
  amount_lbp      NUMERIC(18,2),
  lbp_rate        NUMERIC(14,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT budget_line_lbp_pair CHECK ((amount_lbp IS NULL) = (lbp_rate IS NULL))
);
CREATE INDEX IF NOT EXISTS budget_lines_budget_idx ON budget_lines(budget_id);
CREATE INDEX IF NOT EXISTS budgets_period_idx ON budgets(building_id, compound_id, period_start);

ALTER TABLE dues ADD COLUMN IF NOT EXISTS budget_id UUID REFERENCES budgets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS dues_budget_idx ON dues(budget_id) WHERE budget_id IS NOT NULL;

-- ------------------------------------------------------------
-- RLS. Residents may read the budget behind their dues (it is the transparency
-- story: what am I prepaying FOR); writes need charge.manage, like issuing
-- dues does.
-- ------------------------------------------------------------
ALTER TABLE budgets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS budgets_select ON budgets;
CREATE POLICY budgets_select ON budgets FOR SELECT USING (
  is_platform_admin()
  OR (building_id IS NOT NULL AND (
        user_can(building_id, 'finance.view')
        OR EXISTS (SELECT 1 FROM memberships m JOIN units u ON u.id = m.unit_id
                    WHERE u.building_id = budgets.building_id AND m.user_id = auth.uid())))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b
        WHERE b.compound_id = budgets.compound_id
          AND (user_can(b.id, 'finance.view')
               OR EXISTS (SELECT 1 FROM memberships m JOIN units u ON u.id = m.unit_id
                           WHERE u.building_id = b.id AND m.user_id = auth.uid()))))
);

DROP POLICY IF EXISTS budgets_write ON budgets;
CREATE POLICY budgets_write ON budgets FOR ALL USING (
  is_platform_admin()
  OR (building_id IS NOT NULL AND user_can(building_id, 'charge.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = budgets.compound_id AND user_can(b.id, 'charge.manage')))
) WITH CHECK (
  is_platform_admin()
  OR (building_id IS NOT NULL AND user_can(building_id, 'charge.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = budgets.compound_id AND user_can(b.id, 'charge.manage')))
);

DROP POLICY IF EXISTS budget_lines_select ON budget_lines;
CREATE POLICY budget_lines_select ON budget_lines FOR SELECT USING (
  EXISTS (SELECT 1 FROM budgets g WHERE g.id = budget_lines.budget_id)
);
DROP POLICY IF EXISTS budget_lines_write ON budget_lines;
CREATE POLICY budget_lines_write ON budget_lines FOR ALL USING (
  EXISTS (SELECT 1 FROM budgets g WHERE g.id = budget_lines.budget_id
    AND (is_platform_admin()
      OR (g.building_id IS NOT NULL AND user_can(g.building_id, 'charge.manage'))
      OR (g.compound_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM buildings b WHERE b.compound_id = g.compound_id AND user_can(b.id, 'charge.manage')))))
) WITH CHECK (
  EXISTS (SELECT 1 FROM budgets g WHERE g.id = budget_lines.budget_id
    AND (is_platform_admin()
      OR (g.building_id IS NOT NULL AND user_can(g.building_id, 'charge.manage'))
      OR (g.compound_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM buildings b WHERE b.compound_id = g.compound_id AND user_can(b.id, 'charge.manage')))))
);

COMMIT;

-- ============================================================
-- Post-run checks:
--   Issue a budget from the app → budgets + budget_lines rows + dues rows with
--   budget_id set; the dues table, reminders and Outstanding-by-unit behave
--   exactly as before (the obligation shape did not change).
-- ============================================================
