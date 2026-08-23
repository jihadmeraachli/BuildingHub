-- ============================================================
-- 0109_projects.sql
-- Projects: the facade, the new generator, the lift replacement.
--
-- WHY. Lumpy money is where committees lose trust: a sum is quoted once, cash
-- is collected up front, invoices arrive over months, and nobody can show the
-- building what happened to the figure. Today "projects" is one value in the
-- expense category enum (0002) — a label, nothing to hang an estimate on.
-- (Binayati review, 23 Aug 2026, F3.)
--
-- WHAT. A project is its own row — title, status, an ESTIMATE, dates, a
-- document — and expenses point at it. Actual cost is never stored: it is
-- Σ expenses.amount_usd WHERE project_id, so estimate-vs-actual is always the
-- truth of the book. Funding comes free from 0106: a project expense is an
-- expense, billed to residents, paid from the fund, or split, like any other.
--
-- Residents can read projects (user_sees_*): this is the transparency page.
-- Only building.manage writes.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS projects (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id    UUID REFERENCES buildings(id) ON DELETE CASCADE,
  compound_id    UUID REFERENCES compounds(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'planned'
                 CHECK (status IN ('planned','approved','in_progress','done','cancelled')),
  estimate_usd   NUMERIC(12,2) CHECK (estimate_usd IS NULL OR estimate_usd >= 0),
  start_date     DATE,
  end_date       DATE,
  attachment_url TEXT,
  created_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT projects_scope CHECK ((building_id IS NOT NULL) <> (compound_id IS NOT NULL)),
  CONSTRAINT projects_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS projects_building_idx ON projects(building_id, status);
CREATE INDEX IF NOT EXISTS projects_compound_idx ON projects(compound_id, status);

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS expenses_project_idx ON expenses(project_id) WHERE project_id IS NOT NULL;
COMMENT ON COLUMN expenses.project_id IS 'The project this expense belongs to (0109). Actual cost of a project = Σ its expenses.';

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projects_select ON projects;
CREATE POLICY projects_select ON projects FOR SELECT USING (
  (building_id IS NOT NULL AND user_sees_building(building_id))
  OR (compound_id IS NOT NULL AND user_sees_compound(compound_id))
);
DROP POLICY IF EXISTS projects_write ON projects;
CREATE POLICY projects_write ON projects FOR ALL USING (
  (building_id IS NOT NULL AND user_can(building_id, 'building.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = projects.compound_id
          AND user_can(b.id, 'building.manage')))
) WITH CHECK (
  (building_id IS NOT NULL AND user_can(building_id, 'building.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = projects.compound_id
          AND user_can(b.id, 'building.manage')))
);

COMMIT;

-- Post-run checks:
--   1. As an admin: create a project, record two expenses against it →
--      the Projects page shows estimate vs the sum of the two.
--   2. As a resident of the building: the project is visible, read-only;
--      an unrelated user sees nothing.
--   3. node scripts/rls-audit.mjs (projects added).
