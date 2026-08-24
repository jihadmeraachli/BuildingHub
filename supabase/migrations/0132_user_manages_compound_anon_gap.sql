-- ============================================================
-- 0132_user_manages_compound_anon_gap.sql
-- Hygiene follow-up to 0131. The new user_manages_compound() was granted to
-- authenticated but not revoked from PUBLIC, so the Postgres default left it
-- anon-callable. It is HARMLESS (for an anon caller auth.uid() is null, so it
-- always returns false and reveals nothing about any compound), but it does
-- not match the anon-gap standard applied to every other definer function in
-- 0111/0119/0122. Close it for consistency.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

REVOKE ALL ON FUNCTION user_manages_compound(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION user_manages_compound(UUID) TO authenticated;

COMMIT;

-- Post-run check:
--   Anon: rpc('user_manages_compound', {p_compound:'<uuid>'}) -> 401/permission
--     denied (was: 200 false).
--   Signed in: unchanged — buildings/compounds insert + create_building still
--     work for legitimate compound/org admins.
