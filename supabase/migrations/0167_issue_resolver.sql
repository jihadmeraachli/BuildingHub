-- ============================================================
-- 0167_issue_resolver.sql
-- "Resolved on {date} by {name}" (Jey, 31 Aug). Who flipped the issue to
-- resolved: resolved_by (audit id) + resolved_by_name (display snapshot,
-- the 0123 inspector pattern - survives user deletion, no join/RLS
-- gymnastics on the residents' read path). Both cleared on reopen by the
-- client. Additive & idempotent.
-- ============================================================
BEGIN;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_by_name TEXT;
COMMIT;
-- Post-run check: resolve an issue -> its card reads "Resolved on {date} by {you}".
