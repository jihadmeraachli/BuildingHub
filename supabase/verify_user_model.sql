-- ============================================================
-- verify_user_model.sql — READ-ONLY health check for 0026 + 0027 + 0028.
-- Paste into Supabase → SQL Editor → Run. Every row should read ✅ PASS.
-- Failures sort to the top.
-- (Supersedes verify_0026.sql.)
-- ============================================================
WITH checks(label, pass) AS (

  -- ---------- 0026: lifecycle ----------
  SELECT '0026 · deactivation guard installed',
         EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='profiles_deactivation_guard_trg' AND NOT tgisinternal AND tgenabled <> 'D')
  UNION ALL
  SELECT '0026 · grants hierarchy guard installed',
         EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='grants_hierarchy_guard_trg' AND NOT tgisinternal AND tgenabled <> 'D')
  UNION ALL
  SELECT '0026 · memberships.ended_at exists',
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='memberships' AND column_name='ended_at')
  UNION ALL
  SELECT '0026 · profiles deactivation audit columns (3)',
         (SELECT count(*) FROM information_schema.columns
           WHERE table_name='profiles' AND column_name IN ('deactivated_at','deactivated_by','deactivation_reason')) = 3
  UNION ALL
  SELECT '0026 · audit FKs to profiles are ON DELETE SET NULL',
         (SELECT count(*) FROM pg_constraint WHERE contype='f' AND confrelid='profiles'::regclass AND confdeltype='n') >= 6
  UNION ALL
  SELECT '0026 · data safety: no residency ended by migration',
         (SELECT count(*) FROM memberships WHERE ended_at IS NOT NULL) = 0

  -- ---------- 0027: compound scope ----------
  UNION ALL
  SELECT '0027 · grants.compound_id exists',
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='grants' AND column_name='compound_id')
  UNION ALL
  SELECT '0027 · scope_type allows compound',
         (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='grants_scope_type_check') ILIKE '%compound%'
  UNION ALL
  SELECT '0027 · ladder org>compound>building>super>finance>viewer',
         role_rank('org_admin')      > role_rank('compound_admin')
     AND role_rank('compound_admin') > role_rank('building_admin')
     AND role_rank('building_admin') > role_rank('building_super')
     AND role_rank('building_super') > role_rank('building_finance')
     AND role_rank('building_finance') > role_rank('viewer')
  UNION ALL
  SELECT '0027 · compound_admin has building powers, not org powers',
         role_has_cap('compound_admin','expense.manage')
     AND role_has_cap('compound_admin','resident.manage')
     AND NOT role_has_cap('compound_admin','org.manage')
  UNION ALL
  SELECT '0027 · building_super NEVER sees money',
         NOT role_has_cap('building_super','finance.view')
     AND NOT role_has_cap('building_super','payment.record')
     AND NOT role_has_cap('building_super','expense.manage')
     AND NOT role_has_cap('building_super','charge.manage')
     AND role_has_cap('building_super','issue.update')
  UNION ALL
  SELECT '0027 · building_admin lost org powers (the split)',
         NOT role_has_cap('building_admin','org.manage')
     AND NOT role_has_cap('building_admin','org.assign_buildings')
     AND role_has_cap('org_admin','org.manage')
  UNION ALL
  SELECT '0027 · user.delete is in NO role (platform only)',
         NOT role_has_cap('org_admin','user.delete')
     AND NOT role_has_cap('compound_admin','user.delete')
     AND NOT role_has_cap('building_admin','user.delete')

  -- ---------- 0028: the legacy-role lie ----------
  UNION ALL
  SELECT '0028 · no active admin left without a grant (backfill worked)',
         (SELECT count(*) FROM profiles p
           WHERE p.status='active' AND p.role='building_admin'
             AND NOT EXISTS (SELECT 1 FROM grants g WHERE g.user_id=p.id)) = 0
  UNION ALL
  SELECT '0028 · notifications know about compound scope',
         pg_get_functiondef('building_admin_ids(uuid)'::regprocedure) ILIKE '%scope_type = ''compound''%'

  -- ---------- integrity ----------
  UNION ALL
  SELECT 'integrity · every grant has exactly one scope id',
         (SELECT count(*) FROM grants
           WHERE (scope_type='building' AND building_id IS NULL)
              OR (scope_type='compound' AND compound_id IS NULL)
              OR (scope_type='org'      AND org_id      IS NULL)) = 0
  UNION ALL
  SELECT 'integrity · no building is left without an active admin',
         NOT EXISTS (
           SELECT 1 FROM buildings b
           WHERE b.is_active AND building_active_admin_count(b.id) = 0)
)
SELECT CASE WHEN pass THEN '✅ PASS' ELSE '❌ FAIL' END AS result, label
FROM checks
ORDER BY pass ASC, label;


-- ============================================================
-- Who administers what, now that grants tell the truth.
-- Expect Jihad to appear for Rawdah Tower after 0028.
-- ============================================================
SELECT
  b.name                                   AS building,
  c.name                                   AS compound,
  p.full_name                              AS admin,
  g.role,
  g.scope_type                             AS granted_at_level,
  building_active_admin_count(b.id)        AS active_admins_on_block
FROM buildings b
LEFT JOIN compounds c ON c.id = b.compound_id
LEFT JOIN grants g
  ON g.role IN ('building_admin','compound_admin','org_admin')
 AND (
      (g.scope_type='building' AND g.building_id = b.id)
   OR (g.scope_type='compound' AND g.compound_id = b.compound_id)
   OR (g.scope_type='org' AND EXISTS (
         SELECT 1 FROM org_buildings ob WHERE ob.org_id=g.org_id AND ob.building_id=b.id))
 )
LEFT JOIN profiles p ON p.id = g.user_id AND p.status = 'active'
WHERE b.is_active
ORDER BY c.name NULLS LAST, b.name, g.scope_type;
