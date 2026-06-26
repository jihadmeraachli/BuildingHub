-- ============================================================
-- BuildingHub — billing mode per building / compound
-- 'arrears' = pay actual balance (default, current model)
-- 'dues'    = fixed prepayments (dues plan + period generation)
-- Chosen at compound level (if in a compound) or building level
-- (if standalone). Safe to re-run.
-- ============================================================
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'arrears'
  CHECK (billing_mode IN ('arrears','dues'));
ALTER TABLE compounds ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'arrears'
  CHECK (billing_mode IN ('arrears','dues'));
