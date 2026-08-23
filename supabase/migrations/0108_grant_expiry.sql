-- ============================================================
-- 0108_grant_expiry.sql
-- Management access that can end on its own.
--
-- WHY. A grant has created_at and nothing else: a treasurer who leaves the
-- committee keeps finance access until a human remembers to revoke it, nothing
-- prompts anyone to look, and no record exists that a term ever ended.
-- (Binayati review, 23 Aug 2026, finding C2.)
--
-- WHAT.
--   grants.expires_at         NULL = open-ended (today's behaviour, unchanged).
--   grants.expiry_notified_on the day the "about to lapse" reminder went out,
--                             so the cron never sends it twice.
--   grant_history             every grant that ended, with when and why. The
--                             answer to "who was treasurer in 2024" — and the
--                             seed of committee terms later.
--   user_can()                ignores an expired grant IMMEDIATELY. All money
--   user_sees_building()      and visibility RLS routes through these, so the
--   user_sees_compound()      access stops the second the date passes, with no
--   user_max_rank()           job in between.
--   sweep_expired_grants()    moves expired rows to grant_history. The cron
--                             calls it each morning; until then an expired
--                             grant is inert (the four functions above) but
--                             still listed, so the People page can show it as
--                             "expired" rather than have it vanish.
--   expiring_grants(days)     what the cron reminds about: grants lapsing
--                             within N days, with the holder and the scope's
--                             admins, not yet notified.
--
-- Other grant readers (0031 licensing counts, can_view_profile, find_user_by
-- _email, can_delete_user) are deliberately left alone: they decide what a
-- person may SEE or whether a profile may be deleted, and a day's lag there
-- is harmless. The sweep closes them.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Columns
-- ------------------------------------------------------------
ALTER TABLE grants ADD COLUMN IF NOT EXISTS expires_at DATE;
ALTER TABLE grants ADD COLUMN IF NOT EXISTS expiry_notified_on DATE;
COMMENT ON COLUMN grants.expires_at IS 'Last day the grant is valid (inclusive). NULL = open-ended.';
COMMENT ON COLUMN grants.expiry_notified_on IS 'Day the about-to-lapse reminder went out; cleared when expires_at changes.';

-- a changed date means a fresh reminder is due
CREATE OR REPLACE FUNCTION trg_grant_expiry_reset() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN NEW.expiry_notified_on := NULL; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS grant_expiry_reset ON grants;
CREATE TRIGGER grant_expiry_reset BEFORE UPDATE ON grants
  FOR EACH ROW EXECUTE FUNCTION trg_grant_expiry_reset();

-- ------------------------------------------------------------
-- 2. History: a grant that ended, for whatever reason
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grant_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id    UUID NOT NULL,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scope_type  TEXT NOT NULL,
  org_id      UUID,
  compound_id UUID,
  building_id UUID,
  role        TEXT NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL,
  expires_at  DATE,
  ended_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL CHECK (reason IN ('revoked','expired','user_deleted'))
);
CREATE INDEX IF NOT EXISTS grant_history_user_idx ON grant_history(user_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS grant_history_building_idx ON grant_history(building_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS grant_history_compound_idx ON grant_history(compound_id, ended_at DESC);

-- every delete is recorded; the sweep marks its own rows 'expired' through a
-- transaction-local flag, everything else is a human revoking
CREATE OR REPLACE FUNCTION trg_grant_history() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO grant_history (grant_id, user_id, scope_type, org_id, compound_id, building_id, role, granted_at, expires_at, ended_by, reason)
  VALUES (OLD.id, OLD.user_id, OLD.scope_type, OLD.org_id, OLD.compound_id, OLD.building_id, OLD.role, OLD.created_at, OLD.expires_at,
          auth.uid(),
          CASE WHEN current_setting('abniyah.grant_sweep', true) = '1' THEN 'expired'
               WHEN NOT EXISTS (SELECT 1 FROM profiles WHERE id = OLD.user_id) THEN 'user_deleted'
               ELSE 'revoked' END);
  RETURN OLD;
EXCEPTION WHEN foreign_key_violation THEN
  -- the profile itself is being deleted (cascade): nothing to keep
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS grant_history_trg ON grants;
CREATE TRIGGER grant_history_trg AFTER DELETE ON grants
  FOR EACH ROW EXECUTE FUNCTION trg_grant_history();

ALTER TABLE grant_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS grant_history_select ON grant_history;
CREATE POLICY grant_history_select ON grant_history FOR SELECT USING (
  is_platform_admin()
  OR user_id = auth.uid()
  OR (building_id IS NOT NULL AND user_can(building_id, 'grant.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = grant_history.compound_id
          AND user_can(b.id, 'grant.manage')))
  OR (org_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM org_buildings ob WHERE ob.org_id = grant_history.org_id
          AND user_can(ob.building_id, 'grant.manage')))
);
-- no client writes: the trigger is the only author

-- ------------------------------------------------------------
-- 3. The gates ignore an expired grant at once
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION user_can(p_building UUID, p_cap TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE r TEXT;
BEGIN
  IF is_platform_admin() THEN RETURN TRUE; END IF;
  FOR r IN
    SELECT g.role FROM grants g
    WHERE g.user_id = auth.uid()
      AND (g.expires_at IS NULL OR g.expires_at >= CURRENT_DATE)          -- 0108
      AND (
        (g.scope_type = 'building' AND g.building_id = p_building)
        OR (g.scope_type = 'compound' AND EXISTS (
              SELECT 1 FROM buildings b
              WHERE b.id = p_building AND b.compound_id = g.compound_id))
        OR (g.scope_type = 'org' AND EXISTS (
              SELECT 1 FROM org_buildings ob
              WHERE ob.org_id = g.org_id AND ob.building_id = p_building))
      )
  LOOP
    IF role_has_cap(r, p_cap) THEN RETURN TRUE; END IF;
  END LOOP;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION user_sees_building(p_building UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT is_platform_admin()
      OR EXISTS (
           SELECT 1 FROM grants g
           WHERE g.user_id = auth.uid()
             AND (g.expires_at IS NULL OR g.expires_at >= CURRENT_DATE)
             AND ( (g.scope_type = 'building' AND g.building_id = p_building)
                OR (g.scope_type = 'compound' AND g.compound_id =
                      (SELECT compound_id FROM buildings WHERE id = p_building))
                OR (g.scope_type = 'org' AND EXISTS (
                      SELECT 1 FROM org_buildings ob
                      WHERE ob.org_id = g.org_id AND ob.building_id = p_building)) ))
      OR EXISTS (
           SELECT 1 FROM memberships m
           JOIN units u ON u.id = m.unit_id
           WHERE u.building_id = p_building AND m.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION user_sees_compound(p_compound UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT is_platform_admin()
      OR EXISTS (
           SELECT 1 FROM grants g
           WHERE g.user_id = auth.uid()
             AND (g.expires_at IS NULL OR g.expires_at >= CURRENT_DATE)
             AND ( (g.scope_type = 'compound' AND g.compound_id = p_compound)
                OR (g.scope_type = 'org' AND g.org_id =
                      (SELECT org_id FROM compounds WHERE id = p_compound))
                OR (g.scope_type = 'building' AND EXISTS (
                      SELECT 1 FROM buildings b
                      WHERE b.id = g.building_id AND b.compound_id = p_compound)) ))
      OR EXISTS (
           SELECT 1 FROM memberships m
           JOIN units u     ON u.id = m.unit_id
           JOIN buildings b ON b.id = u.building_id
           WHERE b.compound_id = p_compound AND m.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION user_max_rank(p_user UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT CASE
    WHEN COALESCE((SELECT is_platform_admin FROM profiles WHERE id = p_user), FALSE) THEN 100
    ELSE COALESCE((SELECT MAX(role_rank(g.role)) FROM grants g
                    WHERE g.user_id = p_user
                      AND (g.expires_at IS NULL OR g.expires_at >= CURRENT_DATE)), 10)
  END;
$$;

-- ------------------------------------------------------------
-- 4. The sweep and the reminder feed, for the morning cron (service role)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sweep_expired_grants()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n INT;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'sweep_expired_grants is for the service role' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('abniyah.grant_sweep', '1', true);
  WITH gone AS (
    DELETE FROM grants WHERE expires_at IS NOT NULL AND expires_at < CURRENT_DATE RETURNING 1
  ) SELECT COUNT(*) INTO n FROM gone;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION sweep_expired_grants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sweep_expired_grants() TO service_role;

-- Grants lapsing within N days that nobody has been told about yet, with the
-- people to tell: the holder, and the admins of the scope.
CREATE OR REPLACE FUNCTION expiring_grants(p_days INT DEFAULT 7)
RETURNS TABLE(
  grant_id UUID, user_id UUID, role TEXT, expires_at DATE,
  scope_name TEXT, building_id UUID, admin_user_ids UUID[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'expiring_grants is for the service role' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT g.id, g.user_id, g.role, g.expires_at,
    COALESCE(b.name, c.name, o.name, '') AS scope_name,
    -- one building to hang the in-app notification on
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
REVOKE ALL ON FUNCTION expiring_grants(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expiring_grants(INT) TO service_role;

COMMIT;

-- ============================================================
-- Post-run checks:
--   1. As an admin: set expires_at on a test grant to yesterday →
--      that user's user_can() is FALSE at once (their Finance page empties),
--      the People page lists the grant as expired.
--   2. SELECT sweep_expired_grants();  (SQL Editor runs as postgres)
--      → the row is gone from grants and present in grant_history, reason 'expired'.
--   3. Revoke a grant from the People page → grant_history row, reason 'revoked',
--      ended_by = you.
--   4. SELECT * FROM expiring_grants(7); → lapsing grants with admin ids.
--   5. node scripts/rls-audit.mjs (grant_history added).
-- ============================================================
