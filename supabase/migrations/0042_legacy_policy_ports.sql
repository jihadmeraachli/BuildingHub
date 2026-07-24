-- ============================================================
-- 0042_legacy_policy_ports.sql
-- Audit findings H2, M1 + the "0039 class": several tables' policies still
-- live only in the v2 schema (schema.sql), gated on the legacy
-- current_user_role() — which (a) doesn't know about v3 grants, so real
-- managers get empty pages, and (b) still carries power ('super_admin'),
-- while building admins could still WRITE profiles.role on others → legacy
-- privilege escalation.
--
-- This migration:
--   1. meetings        → grants-model policies (replaces schema.sql set)
--   2. billing_entries → grants-model policies (replaces schema.sql set)
--   3. buildings       → platform ALL + v3 manager UPDATE; drops legacy
--                        super_admin ALL policy
--   4. issues (0007)   → drops the legacy current_user_role() arms; reporters
--                        can no longer retarget an issue to another building
--   5. profiles guard  → non-platform callers can no longer change ANYONE's
--                        legacy role field (H2 escalation closed)
--   6. grants guard    → UPDATE now checks BOTH old and new role, closing the
--                        same-rank demotion hole (M1)
--
-- Legacy DATA paths (profiles.building_id for residents) keep working — only
-- legacy ROLE power is retired.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. MEETINGS — grants model.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "meetings_select"        ON meetings;
DROP POLICY IF EXISTS "meetings_insert_admin"  ON meetings;
DROP POLICY IF EXISTS "meetings_update_admin"  ON meetings;
DROP POLICY IF EXISTS "meetings_delete_admin"  ON meetings;

CREATE POLICY "meetings_select" ON meetings FOR SELECT USING (
  is_platform_admin()
  OR user_member_building(building_id)
  OR building_id = (SELECT building_id FROM profiles WHERE id = auth.uid())
  OR user_can(building_id, 'meeting.manage')
  OR user_can(building_id, 'issue.view_all')
  OR user_can(building_id, 'finance.view')
);

CREATE POLICY "meetings_write" ON meetings FOR INSERT WITH CHECK (
  is_platform_admin() OR user_can(building_id, 'meeting.manage')
);
CREATE POLICY "meetings_update" ON meetings FOR UPDATE
  USING (is_platform_admin() OR user_can(building_id, 'meeting.manage'))
  WITH CHECK (is_platform_admin() OR user_can(building_id, 'meeting.manage'));
CREATE POLICY "meetings_delete" ON meetings FOR DELETE USING (
  is_platform_admin() OR user_can(building_id, 'meeting.manage')
);

-- ------------------------------------------------------------
-- 2. BILLING_ENTRIES (legacy table, kept for historical data) — grants model.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "billing_select_resident" ON billing_entries;
DROP POLICY IF EXISTS "billing_insert_admin"    ON billing_entries;
DROP POLICY IF EXISTS "billing_update_admin"    ON billing_entries;

CREATE POLICY "billing_entries_select" ON billing_entries FOR SELECT USING (
  is_platform_admin()
  OR user_can(building_id, 'finance.view')
  OR (
    (user_member_building(building_id)
     OR building_id = (SELECT building_id FROM profiles WHERE id = auth.uid()))
    AND (
      apartment_number IS NULL
      OR apartment_number = (SELECT apartment_number FROM profiles WHERE id = auth.uid())
    )
  )
);
CREATE POLICY "billing_entries_write" ON billing_entries FOR INSERT WITH CHECK (
  is_platform_admin() OR user_can(building_id, 'expense.manage')
);
CREATE POLICY "billing_entries_update" ON billing_entries FOR UPDATE
  USING (is_platform_admin() OR user_can(building_id, 'expense.manage'))
  WITH CHECK (is_platform_admin() OR user_can(building_id, 'expense.manage'));

-- ------------------------------------------------------------
-- 3. BUILDINGS — platform ALL replaces legacy super_admin ALL; v3 managers
--    get UPDATE on their own buildings.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "buildings_all_super_admin" ON buildings;

DROP POLICY IF EXISTS "buildings_all_platform" ON buildings;
CREATE POLICY "buildings_all_platform" ON buildings
  FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "buildings_update_manager" ON buildings;
CREATE POLICY "buildings_update_manager" ON buildings
  FOR UPDATE
  USING (user_can(id, 'building.manage'))
  WITH CHECK (user_can(id, 'building.manage'));

-- ------------------------------------------------------------
-- 4. ISSUES — retire legacy arms; reporters can't retarget the building.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "issues_select" ON issues;
DROP POLICY IF EXISTS "issues_insert" ON issues;
DROP POLICY IF EXISTS "issues_update" ON issues;
DROP POLICY IF EXISTS "issues_delete" ON issues;

CREATE POLICY "issues_select" ON issues FOR SELECT USING (
  is_platform_admin()
  OR user_can(building_id, 'issue.view_all')
  OR reported_by = auth.uid()
);

CREATE POLICY "issues_insert" ON issues FOR INSERT WITH CHECK (
  reported_by = auth.uid()
  AND (
    is_platform_admin()
    OR user_can(building_id, 'issue.update')
    OR user_member_building(building_id)
    OR building_id = (SELECT building_id FROM profiles WHERE id = auth.uid())
  )
);

-- WITH CHECK re-runs on the NEW row: a plain reporter may edit their issue,
-- but only within a building they actually belong to (no retargeting spam).
CREATE POLICY "issues_update" ON issues FOR UPDATE
  USING (
    is_platform_admin()
    OR user_can(building_id, 'issue.update')
    OR reported_by = auth.uid()
  )
  WITH CHECK (
    is_platform_admin()
    OR user_can(building_id, 'issue.update')
    OR (
      reported_by = auth.uid()
      AND (user_member_building(building_id)
           OR building_id = (SELECT building_id FROM profiles WHERE id = auth.uid()))
    )
  );

CREATE POLICY "issues_delete" ON issues FOR DELETE USING (
  is_platform_admin() OR user_can(building_id, 'issue.update')
);

-- ------------------------------------------------------------
-- 5. PROFILES GUARD — the legacy role field becomes platform-only, for
--    EVERYONE's rows (0037 only blocked self-changes).
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
      -- Sanctioned exception: complete_admin_onboarding() sets this
      -- transaction-local flag just before activating the new admin (0037).
      IF NOT (current_setting('abniyah.onboarding', true) = '1' AND NEW.status = 'active') THEN
        RAISE EXCEPTION 'You cannot change your own account status.' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.building_id IS DISTINCT FROM OLD.building_id THEN
      RAISE EXCEPTION 'You cannot move yourself to another building.' USING ERRCODE = '42501';
    END IF;
    IF NEW.apartment_number IS DISTINCT FROM OLD.apartment_number THEN
      RAISE EXCEPTION 'Your apartment is set by your building admin.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Legacy role field still feeds v2 policies — platform-only, on ANY row (0042/H2).
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Only a platform admin can change the legacy role field.' USING ERRCODE = '42501';
  END IF;

  -- ...and non-platform admins may not hand the platform flag to anyone ELSE either.
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

-- ------------------------------------------------------------
-- 6. GRANTS GUARD — UPDATE checks BOTH sides of the change, so an admin can
--    no longer demote a same-rank peer (M1).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION grants_hierarchy_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_rank INT; v_caller_rank INT;
BEGIN
  IF auth.uid() IS NULL OR is_platform_admin() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Sanctioned onboarding self-grant (0038): complete_admin_onboarding() sets
  -- the transaction-local flag; the auto-grant trigger (0031) then inserts the
  -- creator's OWN grant on the entity they just created.
  IF TG_OP = 'INSERT'
     AND NEW.user_id = auth.uid()
     AND current_setting('abniyah.onboarding', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- The rank you must exceed: for UPDATE it is the HIGHER of old/new role,
  -- so neither demoting a peer nor promoting to peer level is possible.
  v_rank := CASE TG_OP
    WHEN 'DELETE' THEN role_rank(OLD.role)
    WHEN 'INSERT' THEN role_rank(NEW.role)
    ELSE GREATEST(role_rank(OLD.role), role_rank(NEW.role))
  END;
  v_caller_rank := user_max_rank(auth.uid());

  IF v_rank >= v_caller_rank THEN
    RAISE EXCEPTION 'You cannot manage a grant at or above your own level.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS grants_hierarchy_guard_trg ON grants;
CREATE TRIGGER grants_hierarchy_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON grants
  FOR EACH ROW EXECUTE FUNCTION grants_hierarchy_guard();

COMMIT;

-- ============================================================
-- Post-run checks:
--   1. As a v3 building_admin: Meetings page loads, create/edit/delete works.
--   2. As a building admin (app console):
--      supabase.from('profiles').update({role:'super_admin'}).eq('id','<other>')
--      → 'Only a platform admin can change the legacy role field.'
--   3. As building_admin A on building_admin B's grant:
--      supabase.from('grants').update({role:'viewer'}).eq('id','<B-grant>')
--      → 'You cannot manage a grant at or above your own level.'
--   4. As a resident: own issues still visible, meetings of own building visible.
-- ============================================================
