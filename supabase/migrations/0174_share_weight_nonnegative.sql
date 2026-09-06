-- ============================================================
-- 0174_share_weight_nonnegative.sql
-- QA sweep 2026-09-06: a unit saved with share_weight = -2 (the number
-- input's min="0" only guards the spinner, not typed/scripted values, and
-- the DB had no constraint). A negative-share unit is CREDITED on every
-- expense allocation and inflates every other unit's slice.
-- Repair any existing negatives to 0 (no allocation), then constrain.
-- Additive & idempotent.
-- ============================================================
BEGIN;

UPDATE units SET share_weight = 0 WHERE share_weight < 0;

ALTER TABLE units DROP CONSTRAINT IF EXISTS units_share_weight_nonneg;
ALTER TABLE units ADD CONSTRAINT units_share_weight_nonneg CHECK (share_weight >= 0);

COMMIT;

-- Post-run: INSERT/UPDATE with share_weight < 0 → constraint violation.
-- Client follow-up (same sweep): Structure.tsx should refuse negatives with
-- a proper message instead of surfacing the raw constraint error.
