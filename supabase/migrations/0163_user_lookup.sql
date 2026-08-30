-- ============================================================
-- 0163_user_lookup.sql
-- Import bug (QA 30 Aug): linking an EXISTING account to a unit never
-- worked. invite-user called admin.auth.admin.getUserByEmail(), which does
-- not exist in the supabase-js v2 the function loads - the call threw, the
-- import swallowed it, and the unit was created with no owner while the
-- progress row said "done".
--
-- The supported lookup: a tiny SECURITY DEFINER function over auth.users,
-- executable by the service role ONLY (the edge function). Exact-match,
-- O(1), no listUsers pagination.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION auth_user_id_by_email(p_email TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT u.id FROM auth.users u
  WHERE lower(u.email) = lower(trim(p_email))
  LIMIT 1;
$$;

-- service_role only - clients must never enumerate accounts by email
REVOKE ALL ON FUNCTION auth_user_id_by_email(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_user_id_by_email(TEXT) FROM anon;
REVOKE ALL ON FUNCTION auth_user_id_by_email(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION auth_user_id_by_email(TEXT) TO service_role;

COMMIT;

-- Post-run check: as service role,
--   SELECT auth_user_id_by_email('jey@meraachli.com');  -> their UUID
-- As a normal user the call is refused (permission denied).
