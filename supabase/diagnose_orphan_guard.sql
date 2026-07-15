-- ============================================================
-- diagnose_orphan_guard.sql — READ-ONLY.
-- Why did deactivating a building's "only admin" go through?
--
-- HOW TO USE: replace the email on the line marked  <<< EDIT  and run.
-- (Supabase SQL Editor: run one query at a time, or select-all and Run.)
-- ============================================================

-- ---------- THE ANSWER ----------
-- One row per building the person touches. Read the `why` column.
WITH target AS (
  SELECT p.id, p.full_name, p.status, p.role AS legacy_role, p.is_platform_admin
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE lower(u.email) = lower('REPLACE-WITH-THEIR-EMAIL@example.com')  -- <<< EDIT
)
SELECT
  b.name                                    AS building,
  t.full_name,
  t.status,
  t.legacy_role                             AS legacy_profiles_role,
  (SELECT count(*) FROM grants g WHERE g.user_id = t.id) AS their_grant_rows,
  user_admins_building(t.id, fb.building)   AS guard_sees_them_as_admin,
  building_active_admin_count(fb.building)  AS active_admins_on_building,
  CASE
    WHEN NOT user_admins_building(t.id, fb.building)
      THEN '→ guard skipped them: not an admin via GRANTS (legacy profiles.role does not count)'
    WHEN building_active_admin_count(fb.building) > 1
      THEN '→ correctly allowed: another active admin still covers this building'
    ELSE '→ BUG: should have been BLOCKED'
  END AS why
FROM target t
CROSS JOIN LATERAL user_footprint_buildings(t.id) AS fb(building)
JOIN buildings b ON b.id = fb.building;
-- NOTE: zero rows back = they have NO grants and NO active membership at all,
-- i.e. the guard had nothing to look at. That itself is the answer.


-- ---------- WHO ELSE ADMINS THOSE BUILDINGS ----------
-- If the query above says "another active admin covers it", this names them.
WITH target AS (
  SELECT p.id FROM profiles p JOIN auth.users u ON u.id = p.id
  WHERE lower(u.email) = lower('REPLACE-WITH-THEIR-EMAIL@example.com')  -- <<< EDIT
)
SELECT DISTINCT
  b.name       AS building,
  p2.full_name AS other_admin,
  g.role,
  g.scope_type,
  p2.status
FROM target t
CROSS JOIN LATERAL user_footprint_buildings(t.id) AS fb(building)
JOIN buildings b ON b.id = fb.building
JOIN grants g
  ON g.role IN ('building_admin','org_admin')
 AND (
      (g.scope_type = 'building' AND g.building_id = fb.building)
   OR (g.scope_type = 'org' AND EXISTS (
         SELECT 1 FROM org_buildings ob
         WHERE ob.org_id = g.org_id AND ob.building_id = fb.building))
 )
JOIN profiles p2 ON p2.id = g.user_id
WHERE p2.id <> t.id;


-- ---------- IS THE GUARD EVEN INSTALLED / ENABLED? ----------
SELECT tgname,
       CASE WHEN tgenabled = 'D' THEN 'DISABLED' ELSE 'enabled' END AS state
FROM pg_trigger
WHERE tgname IN ('profiles_deactivation_guard_trg','grants_hierarchy_guard_trg')
  AND NOT tgisinternal;


-- ---------- HOW MANY ADMINS ARE LEGACY-ONLY (no grants)? ----------
-- If this returns anyone, the grants-based guard is blind to them and we must
-- either backfill grants for them or teach the guard about profiles.role.
SELECT p.full_name, p.role AS legacy_role, p.building_id, p.status
FROM profiles p
WHERE p.role IN ('building_admin','super_admin')
  AND p.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM grants g WHERE g.user_id = p.id);
