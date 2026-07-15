-- ============================================================
-- verify_0026.sql — READ-ONLY health check for migration 0026.
-- Not a migration. Paste into Supabase → SQL Editor → Run.
-- Every row should read ✅ PASS.
-- ============================================================
WITH checks(label, pass) AS (
  -- capability split
  SELECT 'caps · building_admin does NOT have org.manage',
         role_has_cap('building_admin','org.manage') = FALSE
  UNION ALL
  SELECT 'caps · building_admin does NOT have org.assign_buildings',
         role_has_cap('building_admin','org.assign_buildings') = FALSE
  UNION ALL
  SELECT 'caps · org_admin DOES have org.manage',
         role_has_cap('org_admin','org.manage') = TRUE
  UNION ALL
  SELECT 'caps · building_admin CAN deactivate',
         role_has_cap('building_admin','user.deactivate') = TRUE
  UNION ALL
  SELECT 'caps · NO role has user.delete (platform-only)',
         NOT role_has_cap('org_admin','user.delete')
     AND NOT role_has_cap('building_admin','user.delete')
     AND NOT role_has_cap('building_finance','user.delete')
     AND NOT role_has_cap('viewer','user.delete')
  UNION ALL
  SELECT 'caps · building_admin keeps its building powers',
         role_has_cap('building_admin','building.manage')
     AND role_has_cap('building_admin','resident.manage')
     AND role_has_cap('building_admin','finance.view')

  -- hierarchy ladder
  UNION ALL
  SELECT 'rank · org_admin > building_admin > finance > viewer',
         role_rank('org_admin')      > role_rank('building_admin')
     AND role_rank('building_admin') > role_rank('building_finance')
     AND role_rank('building_finance') > role_rank('viewer')

  -- schema
  UNION ALL
  SELECT 'schema · memberships.ended_at exists',
         EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='memberships' AND column_name='ended_at')
  UNION ALL
  SELECT 'schema · profiles deactivation audit columns (3)',
         (SELECT count(*) FROM information_schema.columns
           WHERE table_name='profiles'
             AND column_name IN ('deactivated_at','deactivated_by','deactivation_reason')) = 3
  UNION ALL
  SELECT 'schema · partial unique index memberships_active_uniq',
         EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='memberships_active_uniq')
  UNION ALL
  SELECT 'schema · old UNIQUE(user_id,unit_id) is gone',
         NOT EXISTS (
           SELECT 1 FROM pg_constraint con
            WHERE con.conrelid='memberships'::regclass AND con.contype='u'
              AND (SELECT array_agg(att.attname::TEXT ORDER BY att.attname)
                     FROM unnest(con.conkey) k
                     JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=k)
                  = ARRAY['unit_id','user_id'])

  -- guards
  UNION ALL
  SELECT 'guard · profiles_deactivation_guard_trg installed',
         EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='profiles_deactivation_guard_trg' AND NOT tgisinternal)
  UNION ALL
  SELECT 'guard · grants_hierarchy_guard_trg installed',
         EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='grants_hierarchy_guard_trg' AND NOT tgisinternal)

  -- functions
  UNION ALL
  SELECT 'funcs · all 12 helpers/RPCs created',
         (SELECT count(DISTINCT proname) FROM pg_proc
           WHERE proname IN ('role_rank','unit_balance','user_outstanding','user_max_rank',
                             'user_footprint_buildings','user_admins_building',
                             'building_active_admin_count','deactivate_user','reactivate_user',
                             'end_membership','can_delete_user','delete_user')) = 12

  -- history survives deletion
  UNION ALL
  SELECT 'history · audit FKs to profiles are ON DELETE SET NULL',
         (SELECT count(*) FROM pg_constraint
           WHERE contype='f' AND confrelid='profiles'::regclass AND confdeltype='n') >= 6
  UNION ALL
  SELECT 'history · issues.reported_by is now nullable',
         (SELECT is_nullable FROM information_schema.columns
           WHERE table_name='issues' AND column_name='reported_by') = 'YES'

  -- DATA SAFETY: nothing was lost
  UNION ALL
  SELECT 'data · no residency was ended by the migration',
         (SELECT count(*) FROM memberships WHERE ended_at IS NOT NULL) = 0
  UNION ALL
  SELECT 'data · no user was deactivated by the migration',
         (SELECT count(*) FROM profiles WHERE deactivated_at IS NOT NULL) = 0
)
SELECT CASE WHEN pass THEN '✅ PASS' ELSE '❌ FAIL' END AS result, label
FROM checks
ORDER BY pass ASC, label;   -- failures float to the top
