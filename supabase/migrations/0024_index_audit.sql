-- ============================================================
-- BuildingHub — Index audit (scalability pass)
-- All indexes are IF NOT EXISTS — safe to re-run.
-- ============================================================

-- ── org_buildings — CRITICAL ─────────────────────────────────────────────────
-- user_can() does: WHERE ob.org_id = g.org_id AND ob.building_id = p_building
-- on EVERY RLS-protected query for org-scoped users. No index existed.
CREATE INDEX IF NOT EXISTS org_buildings_org_idx      ON org_buildings(org_id);
CREATE INDEX IF NOT EXISTS org_buildings_building_idx ON org_buildings(building_id);
-- Composite covers the exact filter pattern inside user_can():
CREATE UNIQUE INDEX IF NOT EXISTS org_buildings_org_building_idx ON org_buildings(org_id, building_id);

-- ── compounds — new org_id column (migration 0022, no index created) ─────────
-- Used in RLS: WHERE compound_id IS NULL OR org_id = <user's org>
CREATE INDEX IF NOT EXISTS compounds_org_idx ON compounds(org_id);

-- ── inspections — next_due_date for reminder cron ────────────────────────────
-- get_due_inspections() filters WHERE next_due_date <= CURRENT_DATE + N
-- Existing index is on (building_id, inspection_date) — wrong column entirely.
CREATE INDEX IF NOT EXISTS inspections_next_due_idx ON inspections(next_due_date)
  WHERE next_due_date IS NOT NULL;

-- ── dues — due_date for overdue reminders ─────────────────────────────────────
-- get_overdue_dues() filters WHERE due_date < CURRENT_DATE AND amount_due > 0
-- Existing index is on (building_id, period_label) — doesn't help date queries.
CREATE INDEX IF NOT EXISTS dues_due_date_idx ON dues(due_date)
  WHERE due_date IS NOT NULL;

-- ── notifications — user inbox query in Header ────────────────────────────────
-- Header loads: SELECT * FROM notifications ORDER BY created_at DESC LIMIT 30
-- This runs on every page load for every logged-in user.
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications(user_id, created_at DESC);

-- ── memberships — tenure filter in reminder helpers ───────────────────────────
-- get_overdue_units() and get_overdue_dues() join memberships WHERE tenure = 'owner'
-- Existing indexes are (user_id) and (unit_id) separately — no tenure filter.
CREATE INDEX IF NOT EXISTS memberships_unit_tenure_idx
  ON memberships(unit_id, tenure);
