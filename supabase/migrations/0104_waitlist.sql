-- ============================================================
-- 0104_waitlist.sql
-- Somewhere for interest to land before launch (2026-08-21).
--
-- THE PROBLEM, from docs/marketing/content-calendar.md dependency 2: the beta
-- gate is the only page an unauthenticated visitor can reach, and it offers a
-- code or nothing. Anyone who arrives from a post without a code bounces, and
-- there is no way to count how many did. The calendar puts this on the
-- critical path for week 3.
--
-- ANON CAN INSERT, AND NOTHING ELSE. This is the first table in the schema
-- that a logged-out stranger can write to, so the surface is kept as small as
-- it can be:
--   * INSERT only — no SELECT for anon, so the list cannot be harvested back
--     out, and no UPDATE/DELETE, so a row cannot be altered once left.
--   * email is format-checked and length-capped in the database, not only in
--     the form, because the form is not the only way in.
--   * one row per address (case-insensitive), so re-submitting is idempotent
--     rather than a way to inflate the count.
-- What this does NOT stop is someone scripting many DIFFERENT addresses. There
-- is no rate limiting at the RLS layer. The mitigation is that the table holds
-- nothing sensitive and is read only by a platform admin, who will notice a
-- thousand rows appearing in a minute. If it becomes a problem the answer is a
-- captcha or an edge function, not a policy change here.
--
-- source/locale are captured silently by the form, never asked for: the ask
-- stays one field, which is what the calendar specified.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS waitlist (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email      TEXT NOT NULL,
  -- which language they were reading when they signed up, so the follow-up
  -- goes out in it rather than defaulting to English
  locale     TEXT,
  -- where the form was: 'gate' | 'landing' | anything a future surface adds
  source     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT waitlist_email_shape CHECK (
    email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' AND length(email) <= 254
  ),
  CONSTRAINT waitlist_locale_short CHECK (locale IS NULL OR length(locale) <= 8),
  CONSTRAINT waitlist_source_short CHECK (source IS NULL OR length(source) <= 32)
);

COMMENT ON TABLE waitlist IS
  'Pre-launch signups. Writable by anon (INSERT only), readable by platform admins. One row per address; the form asks for email alone and captures locale/source silently.';

-- Case-insensitive uniqueness: Ahmad@x.com and ahmad@x.com are one person.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_lower_idx ON waitlist (lower(email));

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- The one thing a stranger may do.
DROP POLICY IF EXISTS waitlist_insert_anon ON waitlist;
CREATE POLICY waitlist_insert_anon ON waitlist FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Reading the list is a platform-operator job; no building role grants it.
DROP POLICY IF EXISTS waitlist_read_platform ON waitlist;
CREATE POLICY waitlist_read_platform ON waitlist FOR SELECT
  TO authenticated
  USING (is_platform_admin());

DROP POLICY IF EXISTS waitlist_delete_platform ON waitlist;
CREATE POLICY waitlist_delete_platform ON waitlist FOR DELETE
  TO authenticated
  USING (is_platform_admin());

-- Table-level privileges, stated rather than inherited. RLS decides WHICH rows;
-- these decide whether the role may reach the table at all, and a project whose
-- default privileges differ would otherwise fail with a confusing 401 that
-- looks like a policy bug. Deliberately no UPDATE for anyone: a waitlist row is
-- a fact about a moment, and the only correction is deletion.
GRANT INSERT         ON waitlist TO anon, authenticated;
GRANT SELECT, DELETE ON waitlist TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   Signed out (anon key), an insert succeeds and a select returns nothing:
--     INSERT INTO waitlist (email) VALUES ('a@b.com');    -- ok
--     SELECT * FROM waitlist;                             -- 0 rows, not denied
--
--   A malformed address is rejected by the DB, not just the form:
--     INSERT INTO waitlist (email) VALUES ('not-an-email');  -- 23514
--
--   The same address twice is one row:
--     INSERT INTO waitlist (email) VALUES ('A@B.com');    -- 23505 on the 2nd
--
--   How many signed up, as platform admin:
--     SELECT count(*), source FROM waitlist GROUP BY source;
-- ============================================================
