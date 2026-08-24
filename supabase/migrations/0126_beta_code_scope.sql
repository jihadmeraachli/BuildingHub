-- ============================================================
-- 0126_beta_code_scope.sql
-- Scoped beta codes. One code table gated BOTH hosts identically, and the
-- demo lives on the app host — so any code shared for "the website and the
-- demo" (Whish onboarding review) also unlocked /register, which shows the
-- pricing model. A code now carries a scope:
--   'full'  everything (the testers' codes — the default, nothing changes)
--   'demo'  the marketing site and the demo; the client bounces /register
-- verify_beta_code() stays as-is for the currently-deployed bundle; the new
-- client calls beta_code_scope() and stores the scope. Deploy the client
-- BEFORE creating any 'demo' code, or the old bundle accepts it as full.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE beta_access_codes ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'full'
  CHECK (scope IN ('full', 'demo'));
COMMENT ON COLUMN beta_access_codes.scope IS
  'full = whole app; demo = marketing site + demo only (client refuses /register). 0126.';

CREATE OR REPLACE FUNCTION beta_code_scope(p_code TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT scope FROM beta_access_codes
  WHERE upper(code) = upper(trim(p_code)) AND active
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION beta_code_scope TO anon, authenticated;

COMMIT;

-- Post-run checks:
--   SELECT beta_code_scope('<a tester code>');  -- 'full'
--   SELECT beta_code_scope('wrong');            -- NULL
--   For Whish: INSERT INTO beta_access_codes (code, note, scope)
--     VALUES ('WHISH-REVIEW-2026', 'Whish onboarding — deactivate after review', 'demo');
--   Then with that code: site + demo unlock; app.abniyah.com/register bounces.
