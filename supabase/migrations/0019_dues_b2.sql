-- 0019_dues_b2.sql
-- Adds plan_type to dues_plans so a plan can be B1 (arrears true-up) or B2 (flat fee).
-- Default 'b1' keeps all existing plans unchanged.
ALTER TABLE dues_plans ADD COLUMN IF NOT EXISTS plan_type text NOT NULL DEFAULT 'b1';
ALTER TABLE dues_plans DROP CONSTRAINT IF EXISTS dues_plans_plan_type_check;
ALTER TABLE dues_plans ADD CONSTRAINT dues_plans_plan_type_check CHECK (plan_type IN ('b1', 'b2'));
