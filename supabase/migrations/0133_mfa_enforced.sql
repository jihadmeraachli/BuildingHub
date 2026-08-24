-- ============================================================
-- 0133_mfa_enforced.sql
-- SECURITY FIX (audit H2, HIGH): 2FA was enforced nowhere in the database.
--
-- THE HOLE. The aal2 gate lived only in React (ProtectedRoute). An attacker
-- with a 2FA user's PASSWORD calls signInWithPassword directly; the resulting
-- aal1 token is a fully privileged `authenticated` JWT that PostgREST + RLS
-- accept for every read and write the user's grants allow. The TOTP code was
-- never required server-side — MFA only stopped attackers who used the UI.
--
-- THE FIX. A new mfa_satisfied() helper, checked at the top of
-- user_can_unlocked (which every management capability + finance read routes
-- through). It passes when EITHER:
--   · the session is already aal2 (TOTP completed), OR
--   · the user has NO verified MFA factor (nothing to step up to).
-- So a user WITHOUT 2FA is completely unaffected — the common case short-
-- circuits to true. Only a user who HAS a verified factor but is still on an
-- aal1 session is denied, exactly the attack in the finding.
--
-- COVERAGE. This gates everything behind user_can()/user_can_unlocked — all
-- table write policies, finance reads, the subscription read policies. A few
-- RPCs that check is_platform_admin() directly are a smaller, operator-only
-- surface, left for a follow-up. Resident membership read policies (own unit)
-- are also not gated here — lower risk, follow-up.
--
-- LOCKOUT SAFETY. If anything misbehaves, the SQL Editor runs as service_role,
-- which BYPASSES RLS — so you can always paste the ROLLBACK block at the bottom
-- to restore the previous behavior, even if your own app session is denied.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- Has this session cleared 2FA — or does the user not use 2FA at all?
-- STABLE so the planner can hoist it; the aal2 branch short-circuits before
-- touching auth.mfa_factors, so a completed-2FA session pays nothing.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mfa_satisfied()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth AS $$
  SELECT
    COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    OR NOT EXISTS (
      SELECT 1 FROM auth.mfa_factors f
      WHERE f.user_id = auth.uid() AND f.status = 'verified'
    );
$$;
REVOKE ALL ON FUNCTION mfa_satisfied() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mfa_satisfied() TO authenticated;

COMMENT ON FUNCTION mfa_satisfied() IS
  'TRUE when the caller''s session is aal2, or the user has no verified MFA factor. Gates user_can_unlocked so a password-only (aal1) session of a 2FA-enrolled user holds no capability (audit H2).';

-- ------------------------------------------------------------
-- Re-declare user_can_unlocked (0130 body) with the MFA gate FIRST, so it
-- applies to everyone — platform admins included. Order matters: MFA, then
-- platform-admin bypass, then the 0130 active-status check, then grants.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION user_can_unlocked(p_building UUID, p_cap TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE r TEXT;
BEGIN
  -- 0133: a session that has not cleared 2FA holds NO capability. Users
  -- without a verified factor pass straight through (mfa_satisfied = true).
  IF NOT mfa_satisfied() THEN RETURN FALSE; END IF;

  IF is_platform_admin() THEN RETURN TRUE; END IF;

  -- 0130: a deactivated account holds no management capability.
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status = 'active') THEN
    RETURN FALSE;
  END IF;

  FOR r IN
    SELECT g.role FROM grants g
    WHERE g.user_id = auth.uid()
      AND (g.expires_at IS NULL OR g.expires_at >= CURRENT_DATE)
      AND (
        (g.scope_type = 'building' AND g.building_id = p_building)
        OR (g.scope_type = 'compound' AND EXISTS (SELECT 1 FROM buildings b WHERE b.id = p_building AND b.compound_id = g.compound_id))
        OR (g.scope_type = 'org' AND EXISTS (SELECT 1 FROM org_buildings ob WHERE ob.org_id = g.org_id AND ob.building_id = p_building))
      )
  LOOP
    IF role_has_cap(r, p_cap) THEN RETURN TRUE; END IF;
  END LOOP;
  RETURN FALSE;
END;
$$;

COMMIT;

-- Post-run checks:
--   You (2FA), signed in normally (aal2): everything works exactly as before.
--   A user WITHOUT 2FA: completely unaffected — mfa_satisfied() returns true.
--   A 2FA user on a password-only (aal1) session: user_can() now returns false,
--     so every management action + finance read is denied until they complete
--     the TOTP challenge (aal2).
--   Service-role / edge functions: unaffected (no verified factor for a null
--     user → mfa_satisfied true; and they bypass RLS anyway).
--
--   If your OWN app shows permission errors right after this, your session was
--   aal1 — just sign out and back in (completing 2FA) to get an aal2 token.
--
-- ============================================================
-- ROLLBACK (paste in the SQL Editor to fully revert to the 0130 behavior):
-- ------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION user_can_unlocked(p_building UUID, p_cap TEXT)
-- RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
-- DECLARE r TEXT;
-- BEGIN
--   IF is_platform_admin() THEN RETURN TRUE; END IF;
--   IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status = 'active') THEN
--     RETURN FALSE;
--   END IF;
--   FOR r IN
--     SELECT g.role FROM grants g
--     WHERE g.user_id = auth.uid()
--       AND (g.expires_at IS NULL OR g.expires_at >= CURRENT_DATE)
--       AND ((g.scope_type = 'building' AND g.building_id = p_building)
--         OR (g.scope_type = 'compound' AND EXISTS (SELECT 1 FROM buildings b WHERE b.id = p_building AND b.compound_id = g.compound_id))
--         OR (g.scope_type = 'org' AND EXISTS (SELECT 1 FROM org_buildings ob WHERE ob.org_id = g.org_id AND ob.building_id = p_building)))
--   LOOP
--     IF role_has_cap(r, p_cap) THEN RETURN TRUE; END IF;
--   END LOOP;
--   RETURN FALSE;
-- END; $$;
-- ============================================================
