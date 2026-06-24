-- ============================================================
-- BuildingHub — optional apartment on issues (ADDITIVE, re-runnable)
-- ============================================================
ALTER TABLE issues ADD COLUMN IF NOT EXISTS apartment_number TEXT;
