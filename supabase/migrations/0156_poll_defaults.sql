-- ============================================================
-- 0156_poll_defaults.sql
-- Voting rules as building policy (Jey, 2026-08-28).
--
-- The ballot rules (who votes, weighting, secret/open, quorum, threshold,
-- results visibility) are set ONCE per scope under "Voting rules" and every
-- new vote simply uses them - the committee no longer restates them on each
-- vote. One row per building or compound, editable any time by poll.manage.
--
-- Each poll still stores its own COPY of the rules at creation (0155's
-- columns are untouched): changing the defaults later never rewrites a
-- ballot that is already open or closed.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS poll_defaults (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id         UUID REFERENCES buildings(id) ON DELETE CASCADE,
  compound_id         UUID REFERENCES compounds(id) ON DELETE CASCADE,
  anonymous           BOOLEAN NOT NULL DEFAULT TRUE,
  eligibility         TEXT NOT NULL DEFAULT 'all_residents'
                        CHECK (eligibility IN ('all_residents', 'owners_only', 'one_per_unit')),
  weighting           TEXT NOT NULL DEFAULT 'per_person'
                        CHECK (weighting IN ('per_person', 'by_share')),
  choice_type         TEXT NOT NULL DEFAULT 'single' CHECK (choice_type IN ('single', 'multiple')),
  max_choices         INT  NOT NULL DEFAULT 1 CHECK (max_choices >= 1),
  allow_abstain       BOOLEAN NOT NULL DEFAULT TRUE,
  quorum_pct          NUMERIC(5,2) NOT NULL DEFAULT 0  CHECK (quorum_pct >= 0 AND quorum_pct <= 100),
  pass_threshold_pct  NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (pass_threshold_pct > 0 AND pass_threshold_pct <= 100),
  results_visibility  TEXT NOT NULL DEFAULT 'live' CHECK (results_visibility IN ('live', 'after_close')),
  updated_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT poll_defaults_scope CHECK ((building_id IS NOT NULL) <> (compound_id IS NOT NULL)),
  CONSTRAINT poll_defaults_share_per_unit CHECK (weighting <> 'by_share' OR eligibility = 'one_per_unit')
);
CREATE UNIQUE INDEX IF NOT EXISTS poll_defaults_building_uidx ON poll_defaults(building_id) WHERE building_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS poll_defaults_compound_uidx ON poll_defaults(compound_id) WHERE compound_id IS NOT NULL;

ALTER TABLE poll_defaults ENABLE ROW LEVEL SECURITY;

-- everyone in scope may READ the rules of their building (transparency);
-- only poll.manage writes them (helpers from 0155)
DROP POLICY IF EXISTS poll_defaults_select ON poll_defaults;
CREATE POLICY poll_defaults_select ON poll_defaults FOR SELECT
  USING (poll_in_scope(building_id, compound_id));
DROP POLICY IF EXISTS poll_defaults_write ON poll_defaults;
CREATE POLICY poll_defaults_write ON poll_defaults FOR ALL
  USING (poll_can_manage(building_id, compound_id))
  WITH CHECK (poll_can_manage(building_id, compound_id));

COMMIT;

-- ============================================================
-- Post-run checks (SQL Editor):
--   1. As building admin: INSERT/UPDATE a poll_defaults row for their scope
--      → allowed; as a resident → RLS refuses the write but the SELECT works.
--   2. A second row for the same building → unique index refuses.
--   3. weighting='by_share' with eligibility<>'one_per_unit' → CHECK refuses.
-- ============================================================
