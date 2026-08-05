-- ============================================================
-- 0083_meeting_issues.sql
-- Put open issues on a meeting agenda (#56, Jey's design): when scheduling,
-- the admin ticks "include open issues" and picks which ones — all, or a
-- selection. Deliberately NOT automatic: an agenda auto-stuffed with every
-- open issue is noise, and the admin knows which ones need committee time.
--
-- A JOIN TABLE rather than text pasted into meetings.summary, so the link
-- stays live: an issue resolved between scheduling and the meeting shows as
-- resolved on the agenda, and you can open it from there. A pasted snapshot
-- would quietly go stale.
--
-- Visibility rides on the two tables it joins. This table holds only IDs;
-- reading an issue's CONTENT still goes through the issues policies (0074),
-- so a resident who may not see a neighbour's unit issue does not gain
-- access to it by way of a meeting agenda.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS meeting_issues (
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  issue_id   UUID NOT NULL REFERENCES issues(id)   ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, issue_id)
);

CREATE INDEX IF NOT EXISTS meeting_issues_issue_idx ON meeting_issues(issue_id);

ALTER TABLE meeting_issues ENABLE ROW LEVEL SECURITY;

-- Read: anyone who can read the meeting itself (mirrors meetings_select, 0042).
DROP POLICY IF EXISTS meeting_issues_select ON meeting_issues;
CREATE POLICY meeting_issues_select ON meeting_issues FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM meetings m
    WHERE m.id = meeting_issues.meeting_id
      AND (
        is_platform_admin()
        OR user_member_building(m.building_id)
        OR user_can(m.building_id, 'meeting.manage')
        OR user_can(m.building_id, 'issue.view_all')
        OR user_can(m.building_id, 'finance.view')
      )
  )
);

-- Write: whoever may manage the meeting. The issue must belong to the same
-- building, so an agenda cannot reach into another building's issues.
DROP POLICY IF EXISTS meeting_issues_write ON meeting_issues;
CREATE POLICY meeting_issues_write ON meeting_issues FOR ALL USING (
  EXISTS (
    SELECT 1 FROM meetings m
    WHERE m.id = meeting_issues.meeting_id
      AND (is_platform_admin() OR user_can(m.building_id, 'meeting.manage'))
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM meetings m
    JOIN issues i ON i.id = meeting_issues.issue_id
    WHERE m.id = meeting_issues.meeting_id
      AND i.building_id = m.building_id
      AND (is_platform_admin() OR user_can(m.building_id, 'meeting.manage'))
  )
);

COMMIT;

-- Post-run checks:
--   1. As a building admin: link an open issue to a meeting in the same
--      building -> ok; link an issue from ANOTHER building -> denied.
--   2. As a resident of the building: SELECT from meeting_issues -> rows
--      visible, but joining to issues still hides other units' private issues.
--   3. Delete the meeting -> its meeting_issues rows disappear with it.
