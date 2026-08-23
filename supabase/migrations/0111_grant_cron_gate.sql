-- ============================================================
-- 0111_grant_cron_gate.sql
-- The two cron-only grant functions were callable anonymously.
--
-- 0108 gated sweep_expired_grants() and expiring_grants() with
--   IF auth.uid() IS NOT NULL AND NOT is_platform_admin() THEN RAISE
-- which an ANONYMOUS caller passes (no uid), and REVOKE ... FROM PUBLIC does
-- not touch the EXECUTE that Supabase grants to anon/authenticated by default.
-- Found by calling both with the anon key after 0108 landed: 200, not 403.
--
-- Impact was bounded — the sweep only deletes grants that already confer
-- nothing, and the feed returns who is about to lapse — but a stranger must
-- not be able to trigger either. Fix: refuse anything that is not the
-- service role (the cron) or a platform admin, and revoke EXECUTE explicitly
-- from anon and authenticated.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION sweep_expired_grants()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n INT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'sweep_expired_grants is for the service role' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('abniyah.grant_sweep', '1', true);
  WITH gone AS (
    DELETE FROM grants WHERE expires_at IS NOT NULL AND expires_at < CURRENT_DATE RETURNING 1
  ) SELECT COUNT(*) INTO n FROM gone;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION expiring_grants(p_days INT DEFAULT 7)
RETURNS TABLE(
  grant_id UUID, user_id UUID, role TEXT, expires_at DATE,
  scope_name TEXT, building_id UUID, admin_user_ids UUID[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'expiring_grants is for the service role' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT g.id, g.user_id, g.role, g.expires_at,
    COALESCE(b.name, c.name, o.name, '') AS scope_name,
    COALESCE(g.building_id,
             (SELECT id FROM buildings WHERE compound_id = g.compound_id ORDER BY created_at LIMIT 1),
             (SELECT ob.building_id FROM org_buildings ob WHERE ob.org_id = g.org_id LIMIT 1)) AS building_id,
    ARRAY(
      SELECT DISTINCT a.user_id FROM grants a
      WHERE a.user_id <> g.user_id
        AND (a.expires_at IS NULL OR a.expires_at >= CURRENT_DATE)
        AND role_has_cap(a.role, 'grant.manage')
        AND ( (g.scope_type = 'building' AND (a.building_id = g.building_id
                 OR a.compound_id = (SELECT compound_id FROM buildings WHERE id = g.building_id)
                 OR (a.scope_type = 'org' AND EXISTS (SELECT 1 FROM org_buildings ob WHERE ob.org_id = a.org_id AND ob.building_id = g.building_id))))
           OR (g.scope_type = 'compound' AND (a.compound_id = g.compound_id
                 OR (a.scope_type = 'org' AND a.org_id = (SELECT org_id FROM compounds WHERE id = g.compound_id))))
           OR (g.scope_type = 'org' AND a.scope_type = 'org' AND a.org_id = g.org_id) )
    ) AS admin_user_ids
  FROM grants g
  LEFT JOIN buildings  b ON b.id = g.building_id
  LEFT JOIN compounds  c ON c.id = g.compound_id
  LEFT JOIN organizations o ON o.id = g.org_id
  WHERE g.expires_at IS NOT NULL
    AND g.expires_at >= CURRENT_DATE
    AND g.expires_at <= CURRENT_DATE + p_days
    AND g.expiry_notified_on IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION sweep_expired_grants()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION expiring_grants(INT)    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION sweep_expired_grants()  TO service_role;
GRANT  EXECUTE ON FUNCTION expiring_grants(INT)    TO service_role;

COMMIT;

-- Post-run check: with the ANON key,
--   POST /rest/v1/rpc/sweep_expired_grants  → 401/403 (was 200)
--   POST /rest/v1/rpc/expiring_grants       → 401/403 (was 200)
-- The morning cron (service role) is unaffected.
