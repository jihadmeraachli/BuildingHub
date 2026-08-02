-- ============================================================
-- 0068_feedback.sql
-- In-app feedback widget: testers (and later, customers) report bugs/ideas
-- from inside the app; the file-feedback edge function turns each row into a
-- GitHub issue on the Roadmap board, so intake lands where work is tracked.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  category        TEXT NOT NULL CHECK (category IN ('bug', 'idea', 'question')),
  message         TEXT NOT NULL,
  page            TEXT,          -- route the reporter was on
  device          TEXT,          -- user agent snapshot
  screenshot_path TEXT,          -- attachments-bucket path (private; signed on demand)
  github_issue    INTEGER,       -- set by file-feedback once the issue exists
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feedback_insert_own ON feedback;
CREATE POLICY feedback_insert_own ON feedback
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS feedback_select_own ON feedback;
CREATE POLICY feedback_select_own ON feedback
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR is_platform_admin());

COMMIT;

-- Post-run check: INSERT as a signed-in user succeeds with own user_id,
-- fails with someone else's.
