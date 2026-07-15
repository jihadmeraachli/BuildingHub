-- ============================================================
-- 0029_profile_self_service.sql
-- Make self-service profile editing safe, and stop gating admin edits on the
-- dead legacy role.
--
-- ⚠️ SECURITY (pre-existing, critical):
--    profiles_update_own was  FOR UPDATE USING (id = auth.uid())  with no column
--    restriction. is_platform_admin is a COLUMN on profiles, so ANY authenticated
--    user could simply:
--        update profiles set is_platform_admin = true where id = <self>
--    and gain god-mode across every tenant (is_platform_admin() short-circuits
--    user_can()). They could also self-approve (status='active') or move
--    themselves into another building.
--    Postgres RLS can't express "only these columns", so the invariant is
--    enforced by a BEFORE UPDATE trigger instead.
--
-- 🐛 CORRECTNESS:
--    profiles_update_admin gated on current_user_role() -> profiles.role, the
--    legacy v2 field. So an admin created the correct v3 way (a grant, via
--    People → Access) has role='resident' and CANNOT approve or deactivate
--    residents, while a stale legacy role still could. Re-point it at grants.
--
-- Additive & idempotent. Transactional.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. You may edit your own profile — but not your own privileges.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION profiles_self_update_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- service-role / edge-function context (invite-user, etc.): trusted.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  -- Platform admins are the operator; the flag exists for them.
  IF is_platform_admin() THEN RETURN NEW; END IF;

  -- Nobody may hand themselves privileges.
  IF NEW.id = auth.uid() THEN
    IF NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin THEN
      RAISE EXCEPTION 'You cannot change your own platform-admin flag.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'You cannot change your own account status.' USING ERRCODE = '42501';
    END IF;
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'You cannot change your own role.' USING ERRCODE = '42501';
    END IF;
    IF NEW.building_id IS DISTINCT FROM OLD.building_id THEN
      RAISE EXCEPTION 'You cannot move yourself to another building.' USING ERRCODE = '42501';
    END IF;
    IF NEW.apartment_number IS DISTINCT FROM OLD.apartment_number THEN
      RAISE EXCEPTION 'Your apartment is set by your building admin.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- ...and non-platform admins may not hand it to anyone ELSE either.
  IF NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin THEN
    RAISE EXCEPTION 'Only a platform admin can change the platform-admin flag.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_self_update_guard_trg ON profiles;
CREATE TRIGGER profiles_self_update_guard_trg
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_self_update_guard();

-- Explicit WITH CHECK so the NEW row is validated too (it defaulted to USING,
-- but relying on the default here is exactly the kind of thing that bites).
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ------------------------------------------------------------
-- 2. Admin edits follow GRANTS, not the legacy role.
--    resident.manage is the capability for approving/deactivating people.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_update_admin" ON profiles;
CREATE POLICY "profiles_update_admin" ON profiles
  FOR UPDATE USING (
    is_platform_admin()
    OR (building_id IS NOT NULL AND user_can(building_id, 'resident.manage'))
  );

COMMIT;

-- ------------------------------------------------------------
-- Post-run checks (read-only):
--
--   -- 1. Privilege escalation is closed. Run as a NON-platform-admin user:
--   --    (from the app console, logged in as a resident)
--   --    supabase.from('profiles').update({is_platform_admin:true}).eq('id', myId)
--   --    expect: 'Only a platform admin can change the platform-admin flag.'
--
--   -- 2. Nobody has quietly self-promoted already:
--   SELECT p.full_name, u.email, p.is_platform_admin
--   FROM profiles p JOIN auth.users u ON u.id = p.id
--   WHERE p.is_platform_admin;
--   -- expect: ONLY the operator accounts you recognise. Anyone unexpected here
--   -- self-promoted through the old hole — revoke immediately.
--
--   -- 3. The admin policy no longer mentions the legacy role:
--   SELECT pg_get_expr(polqual, polrelid) AS using_expr
--   FROM pg_policy WHERE polname = 'profiles_update_admin';
--   -- expect: user_can(...) / is_platform_admin(), NOT current_user_role()
-- ------------------------------------------------------------
