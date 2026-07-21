-- ============================================================
-- 0036_beta_access.sql
-- Private-beta gate. The app (when built with VITE_BETA_GATE=1) shows an
-- access-code screen before anything else. Codes live ONLY in this table —
-- never in the client bundle — and are checked via the RPC below.
--
-- RLS: no policies at all → nobody can SELECT codes through the API.
-- Only the SECURITY DEFINER function reads the table.
--
-- To manage codes (SQL Editor):
--   INSERT INTO beta_access_codes (code, note) VALUES ('SOME-CODE', 'for Ali');
--   UPDATE beta_access_codes SET active = false WHERE code = 'SOME-CODE';
--
-- Additive & idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS beta_access_codes (
  code       TEXT PRIMARY KEY,
  active     BOOLEAN NOT NULL DEFAULT true,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deny-all: RLS on, zero policies. The RPC is the only reader.
ALTER TABLE beta_access_codes ENABLE ROW LEVEL SECURITY;

-- Starter code — CHANGE THIS before sharing with testers:
--   UPDATE beta_access_codes SET code = 'YOUR-NEW-CODE' WHERE code = 'ABNIYAH-BETA-2026';
INSERT INTO beta_access_codes (code, note)
VALUES ('ABNIYAH-BETA-2026', 'initial beta code — change me')
ON CONFLICT (code) DO NOTHING;

-- Case-insensitive, whitespace-tolerant check. Callable before login (anon).
CREATE OR REPLACE FUNCTION verify_beta_code(p_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM beta_access_codes
    WHERE upper(code) = upper(trim(p_code)) AND active
  );
$$;

GRANT EXECUTE ON FUNCTION verify_beta_code TO anon, authenticated;

-- ============================================================
-- Post-run check:
--   SELECT verify_beta_code('ABNIYAH-BETA-2026');  -- expect: true
--   SELECT verify_beta_code('wrong');              -- expect: false
--   SELECT * FROM beta_access_codes;               -- works in SQL Editor only
-- ============================================================
