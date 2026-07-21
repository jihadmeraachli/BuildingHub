-- ============================================================
-- 0034_adjustments_and_void.sql
-- Non-cash adjustments (credit notes, discounts, write-offs, penalties,
-- refunds) + soft VOID for money records, so corrections never destroy history.
--
-- Why:
--   * Real buildings issue discounts, forgive/write-off a balance, hand back an
--     overpayment (refund), or add a penalty. None of these are "cash collected"
--     — folding them into `payments` would inflate the P&L. They get their own
--     table so the balance is right AND cash reporting stays clean.
--   * "Deleting" a charge/payment to fix a mistake erases the audit trail. Instead
--     rows are VOIDED (kept, flagged, excluded from the balance).
--
-- Sign convention matches unit_balance (+ = credit to the resident / less owed):
--   credit_note | discount | waiver | write_off  →  +amount  (reduces what they owe)
--   penalty                                        →  −amount  (they owe more)
--   refund                                         →  −amount  (their credit paid back out)
--
-- Additive & idempotent. Transactional.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Soft-void on the existing money tables (keep the row, drop it from math)
-- ------------------------------------------------------------
ALTER TABLE charges  ADD COLUMN IF NOT EXISTS voided_at  TIMESTAMPTZ;
ALTER TABLE charges  ADD COLUMN IF NOT EXISTS voided_by  UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE charges  ADD COLUMN IF NOT EXISTS void_reason TEXT;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_at  TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_by  UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- ------------------------------------------------------------
-- 2. Adjustments — non-cash changes to a unit's balance.
--    Carries the block (building_id) like charges, so the compound book and
--    per-block slice both work.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS adjustments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id        UUID NOT NULL REFERENCES units(id)     ON DELETE CASCADE,
  building_id    UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN
                   ('credit_note','discount','waiver','write_off','penalty','refund')),
  amount_usd     NUMERIC(12,2) NOT NULL CHECK (amount_usd > 0),  -- always a positive magnitude
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note           TEXT,
  created_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at      TIMESTAMPTZ,
  voided_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  void_reason    TEXT
);
CREATE INDEX IF NOT EXISTS adjustments_unit_idx     ON adjustments(unit_id);
CREATE INDEX IF NOT EXISTS adjustments_building_idx ON adjustments(building_id, effective_date DESC);

ALTER TABLE adjustments ENABLE ROW LEVEL SECURITY;
-- managers with finance.view (or the unit's owner) can read; charge.manage to write
DROP POLICY IF EXISTS adjustments_select ON adjustments;
CREATE POLICY adjustments_select ON adjustments FOR SELECT USING (
  user_can(building_id, 'finance.view')
  OR unit_id IN (SELECT user_unit_ids())
);
DROP POLICY IF EXISTS adjustments_write ON adjustments;
CREATE POLICY adjustments_write ON adjustments FOR ALL USING (user_can(building_id, 'charge.manage'))
  WITH CHECK (user_can(building_id, 'charge.manage'));

-- ------------------------------------------------------------
-- 3. Signed effect of an adjustment on the balance.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION adjustment_effect(p_kind TEXT, p_amount NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_kind
    WHEN 'penalty' THEN -p_amount
    WHEN 'refund'  THEN -p_amount
    ELSE p_amount                       -- credit_note, discount, waiver, write_off
  END;
$$;

-- ------------------------------------------------------------
-- 4. Balance = opening + payments − charges + adjustments, all ignoring voided.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION unit_balance(p_unit UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT ROUND(
      COALESCE((SELECT opening_balance FROM units WHERE id = p_unit), 0)
    + COALESCE((SELECT SUM(amount_usd) FROM payments WHERE unit_id = p_unit AND voided_at IS NULL), 0)
    - COALESCE((SELECT SUM(amount_usd) FROM charges  WHERE unit_id = p_unit AND voided_at IS NULL), 0)
    + COALESCE((SELECT SUM(adjustment_effect(kind, amount_usd)) FROM adjustments
                 WHERE unit_id = p_unit AND voided_at IS NULL), 0)
  , 2);
$$;

CREATE OR REPLACE FUNCTION unit_balance_asof(p_unit UUID, p_asof DATE)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT ROUND(
      COALESCE((SELECT opening_balance FROM units
                 WHERE id = p_unit
                   AND (opening_balance_date IS NULL OR opening_balance_date <= p_asof)), 0)
    + COALESCE((SELECT SUM(amount_usd) FROM payments
                 WHERE unit_id = p_unit AND voided_at IS NULL AND paid_on     <= p_asof), 0)
    - COALESCE((SELECT SUM(amount_usd) FROM charges
                 WHERE unit_id = p_unit AND voided_at IS NULL AND charge_date <= p_asof), 0)
    + COALESCE((SELECT SUM(adjustment_effect(kind, amount_usd)) FROM adjustments
                 WHERE unit_id = p_unit AND voided_at IS NULL AND effective_date <= p_asof), 0)
  , 2);
$$;

GRANT EXECUTE ON FUNCTION adjustment_effect(TEXT, NUMERIC) TO authenticated;

COMMIT;

-- ------------------------------------------------------------
-- Post-run checks (read-only):
--   SELECT adjustment_effect('discount', 50)  AS should_be_pos_50,
--          adjustment_effect('penalty', 50)   AS should_be_neg_50,
--          adjustment_effect('refund', 50)    AS should_be_neg_50b;
--   -- void a payment and confirm the balance moves:
--   --   UPDATE payments SET voided_at = now() WHERE id = '<id>';
--   --   SELECT unit_balance('<unit>');
-- ------------------------------------------------------------
