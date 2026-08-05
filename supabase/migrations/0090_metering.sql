-- ============================================================
-- 0090_metering.sql
-- Metering cycles for generator / water (expert session, 2026-08-05).
--
-- An expense type flagged is_metered (0085) gets a per-period cycle: opening
-- stock, what was bought (qty + cost → average unit cost), closing stock, and
-- start/end meter readings per unit plus the common areas. Finalizing computes
-- the pro-rata (math in src/lib/metering.ts, tested) and posts ONE ordinary
-- expense with custom per-unit charges — so the book, the owner/tenant party
-- model, notifications and reminders all treat metered money like any other
-- expense. The cycle is the AUDIT TRAIL of how the amounts were derived.
--
-- Readings survive per cycle so the next one prefills its start readings from
-- the previous end readings.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS meter_cycles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id     UUID REFERENCES buildings(id) ON DELETE CASCADE,
  compound_id     UUID REFERENCES compounds(id) ON DELETE CASCADE,
  expense_type_id UUID NOT NULL REFERENCES expense_types(id) ON DELETE CASCADE,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  -- stock accounting: consumed = opening + added − closing;
  -- unit cost = added_cost / added_qty (average cost of what was bought)
  opening_stock   NUMERIC(14,3) NOT NULL DEFAULT 0,
  added_qty       NUMERIC(14,3) NOT NULL DEFAULT 0,
  added_cost_usd  NUMERIC(12,2) NOT NULL DEFAULT 0,
  added_cost_lbp  NUMERIC(18,2),
  lbp_rate        NUMERIC(14,2),
  closing_stock   NUMERIC(14,3) NOT NULL DEFAULT 0,
  common_method   TEXT NOT NULL DEFAULT 'by_shares' CHECK (common_method IN ('equal','by_shares')),
  billed_to       TEXT NOT NULL DEFAULT 'tenant_where_leased' CHECK (billed_to IN ('tenant_where_leased','owner')),
  status          TEXT NOT NULL DEFAULT 'final' CHECK (status IN ('draft','final')),
  expense_id      UUID REFERENCES expenses(id) ON DELETE SET NULL,
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meter_cycle_scope    CHECK ((building_id IS NOT NULL) <> (compound_id IS NOT NULL)),
  CONSTRAINT meter_cycle_period   CHECK (period_end >= period_start),
  CONSTRAINT meter_cycle_lbp_pair CHECK ((added_cost_lbp IS NULL) = (lbp_rate IS NULL))
);

CREATE TABLE IF NOT EXISTS meter_readings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id      UUID NOT NULL REFERENCES meter_cycles(id) ON DELETE CASCADE,
  unit_id       UUID REFERENCES units(id) ON DELETE CASCADE,  -- NULL = common areas
  start_reading NUMERIC(14,3) NOT NULL DEFAULT 0,
  end_reading   NUMERIC(14,3) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- one reading per unit per cycle; NULLS NOT DISTINCT covers the common row
CREATE UNIQUE INDEX IF NOT EXISTS meter_readings_once_idx
  ON meter_readings (cycle_id, unit_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS meter_cycles_scope_idx
  ON meter_cycles (building_id, compound_id, expense_type_id, period_end DESC);

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS meter_cycle_id UUID REFERENCES meter_cycles(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- RLS: residents can read the cycle behind their charge (transparency);
-- writes need expense.manage, like recording the expense it becomes.
-- ------------------------------------------------------------
ALTER TABLE meter_cycles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE meter_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meter_cycles_select ON meter_cycles;
CREATE POLICY meter_cycles_select ON meter_cycles FOR SELECT USING (
  is_platform_admin()
  OR (building_id IS NOT NULL AND (
        user_can(building_id, 'finance.view')
        OR EXISTS (SELECT 1 FROM memberships m JOIN units u ON u.id = m.unit_id
                    WHERE u.building_id = meter_cycles.building_id AND m.user_id = auth.uid())))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b
        WHERE b.compound_id = meter_cycles.compound_id
          AND (user_can(b.id, 'finance.view')
               OR EXISTS (SELECT 1 FROM memberships m JOIN units u ON u.id = m.unit_id
                           WHERE u.building_id = b.id AND m.user_id = auth.uid()))))
);

DROP POLICY IF EXISTS meter_cycles_write ON meter_cycles;
CREATE POLICY meter_cycles_write ON meter_cycles FOR ALL USING (
  is_platform_admin()
  OR (building_id IS NOT NULL AND user_can(building_id, 'expense.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = meter_cycles.compound_id AND user_can(b.id, 'expense.manage')))
) WITH CHECK (
  is_platform_admin()
  OR (building_id IS NOT NULL AND user_can(building_id, 'expense.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = meter_cycles.compound_id AND user_can(b.id, 'expense.manage')))
);

DROP POLICY IF EXISTS meter_readings_select ON meter_readings;
CREATE POLICY meter_readings_select ON meter_readings FOR SELECT USING (
  EXISTS (SELECT 1 FROM meter_cycles c WHERE c.id = meter_readings.cycle_id)
);
DROP POLICY IF EXISTS meter_readings_write ON meter_readings;
CREATE POLICY meter_readings_write ON meter_readings FOR ALL USING (
  EXISTS (SELECT 1 FROM meter_cycles c WHERE c.id = meter_readings.cycle_id
    AND (is_platform_admin()
      OR (c.building_id IS NOT NULL AND user_can(c.building_id, 'expense.manage'))
      OR (c.compound_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM buildings b WHERE b.compound_id = c.compound_id AND user_can(b.id, 'expense.manage')))))
) WITH CHECK (
  EXISTS (SELECT 1 FROM meter_cycles c WHERE c.id = meter_readings.cycle_id
    AND (is_platform_admin()
      OR (c.building_id IS NOT NULL AND user_can(c.building_id, 'expense.manage'))
      OR (c.compound_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM buildings b WHERE b.compound_id = c.compound_id AND user_can(b.id, 'expense.manage')))))
);

COMMIT;

-- ============================================================
-- Post-run checks:
--   Finalize a cycle in the app → meter_cycles + meter_readings rows, ONE
--   expense with meter_cycle_id and charges whose Σ equals the expense amount
--   to the cent; the next cycle prefills start readings from this one's ends.
-- ============================================================
