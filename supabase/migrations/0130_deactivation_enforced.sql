-- ============================================================
-- 0130_deactivation_enforced.sql
-- SECURITY FIX (audit H3, HIGH): deactivated users kept full API access.
--
-- THE HOLE. user_can()/user_can_unlocked (0114) check grants + expiry but
-- never profiles.status. deactivate_user (0026) only flips status = 'inactive'
-- and signs the user out in React — it does not revoke the refresh token or
-- remove grants. A dismissed manager/collector, using the REST API directly,
-- kept their entire pre-dismissal management access indefinitely.
--
-- THE FIX. user_can_unlocked returns FALSE for any non-platform caller whose
-- profile is not 'active'. This gates ALL grant-based management capability in
-- one place (every table's write policies route through user_can). Platform
-- admins are unaffected (is_platform_admin short-circuits first).
--
-- SCOPE NOTE. Residency (memberships) read policies are separate and still let
-- an inactive *resident* see their own unit — lower risk, and out of scope for
-- this fix, which targets the dismissed-manager case. Belt-and-braces: also
-- revoke the auth session on deactivation via the service-role admin API
-- (an edge-function change, tracked separately).
--
-- Additive & idempotent. Body is 0114's user_can_unlocked verbatim + one guard.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION user_can_unlocked(p_building UUID, p_cap TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE r TEXT;
BEGIN
  IF is_platform_admin() THEN RETURN TRUE; END IF;
  -- 0130: a deactivated account holds no management capability, even if its
  -- grants still exist. The dismissed-manager fix.
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
--   Active manager: unchanged, full access to their scope.
--   Deactivate a manager (profiles.status = 'inactive'), then call any write
--     RPC / REST write with their token → now 42501 / RLS denial, where before
--     it succeeded. (Also confirm the app's own kick still fires.)
--   Reactivate → access restored.
--   Platform admin: unchanged.
