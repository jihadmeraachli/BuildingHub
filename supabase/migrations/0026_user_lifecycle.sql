-- ============================================================
-- 0026_user_lifecycle.sql
-- "Deactivate, don't delete."
--
-- Adds:
--   1. A real role hierarchy (role_rank) — building_admin < org_admin.
--   2. Capability split: building_admin loses org.manage/org.assign_buildings.
--      New caps: user.deactivate (admins) and user.delete (platform only).
--   3. Balance helpers (unit_balance / user_outstanding) — money is anchored
--      to the UNIT, so removing a person never erases a debt.
--   4. Soft-end memberships (ended_at) — move-out keeps who-owed-what history.
--   5. Guards enforced in the DB (triggers), not the UI:
--        - nobody deactivates themselves
--        - you cannot deactivate someone at/above your level
--        - you cannot touch someone who belongs to a building you don't manage
--        - you cannot orphan a building (last active admin)
--   6. delete_user() — platform admin ONLY, blocked while they owe money or
--      hold grants. Audit FKs relaxed to ON DELETE SET NULL so history
--      survives as "deleted user" instead of blocking the delete.
--
-- Additive & idempotent. Safe to re-run.
--
-- NOTHING here deletes data: no DROP TABLE/COLUMN, no TRUNCATE, no top-level
-- DELETE/UPDATE of rows. The DROPs are constraint/trigger metadata that are
-- re-created immediately, and DROP NOT NULL only *relaxes* a rule.
-- The `DELETE FROM auth.users` further down lives INSIDE the delete_user()
-- function body — it is a definition, not something this script executes.
-- (Supabase's SQL editor keyword-scans and will still warn. That's expected.)
--
-- Wrapped in a transaction: Postgres DDL is transactional, so if any single
-- statement fails, the ENTIRE migration rolls back and the DB is untouched.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Role hierarchy
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION role_rank(p_role TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role
    WHEN 'org_admin'        THEN 80
    WHEN 'building_admin'   THEN 60
    WHEN 'org_finance'      THEN 40
    WHEN 'building_finance' THEN 40
    WHEN 'viewer'           THEN 20
    ELSE 0
  END;
$$;

-- ------------------------------------------------------------
-- 2. Capability bundles — building_admin is now strictly BELOW org_admin.
--    KEEP IN SYNC with src/lib/permissions.ts
--    NOTE: 'user.delete' is deliberately in NO role — platform admin only
--    (is_platform_admin() short-circuits user_can()).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION role_has_cap(p_role TEXT, p_cap TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_role = 'org_admin' THEN p_cap IN (
      'building.manage','unit.manage','group.manage',
      'resident.approve','resident.manage','grant.manage',
      'issue.view_all','issue.update',
      'expense.manage','charge.manage','payment.record','payment.confirm','finance.view',
      'meeting.manage','org.manage','org.assign_buildings',
      'user.deactivate')
    WHEN p_role = 'building_admin' THEN p_cap IN (
      'building.manage','unit.manage','group.manage',
      'resident.approve','resident.manage','grant.manage',
      'issue.view_all','issue.update',
      'expense.manage','charge.manage','payment.record','payment.confirm','finance.view',
      'meeting.manage',
      'user.deactivate')
      -- ✗ org.manage  ✗ org.assign_buildings  (org-level only)
    WHEN p_role IN ('building_finance','org_finance') THEN p_cap IN (
      'expense.manage','charge.manage','payment.record','payment.confirm','finance.view')
    WHEN p_role = 'viewer' THEN p_cap IN ('finance.view','issue.view_all')
    ELSE FALSE
  END;
$$;

-- ------------------------------------------------------------
-- 3. Soft-end memberships (move-out without losing history)
-- ------------------------------------------------------------
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

-- The old UNIQUE(user_id, unit_id) would block re-adding someone to a unit
-- they previously left. Replace with a partial unique on ACTIVE memberships.
-- Match the constraint by its exact column set — never drop "whatever unique
-- constraint happens to be there".
DO $$
DECLARE c TEXT;
BEGIN
  SELECT con.conname INTO c
    FROM pg_constraint con
   WHERE con.conrelid = 'memberships'::regclass
     AND con.contype = 'u'
     AND (
       SELECT array_agg(att.attname::TEXT ORDER BY att.attname)
         FROM unnest(con.conkey) AS k
         JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k
     ) = ARRAY['unit_id','user_id']
   LIMIT 1;

  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE memberships DROP CONSTRAINT %I', c);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS memberships_active_uniq
  ON memberships(user_id, unit_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS memberships_ended_idx ON memberships(ended_at);

-- Residency helpers must ignore ended memberships.
CREATE OR REPLACE FUNCTION user_unit_ids()
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT unit_id FROM memberships WHERE user_id = auth.uid() AND ended_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION user_member_building(p_building UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m JOIN units u ON u.id = m.unit_id
    WHERE m.user_id = auth.uid() AND m.ended_at IS NULL AND u.building_id = p_building
  );
$$;

-- ------------------------------------------------------------
-- 4. Deactivation audit trail on profiles
-- ------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deactivated_at      TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deactivated_by      UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deactivation_reason TEXT;

-- ------------------------------------------------------------
-- 5. Money helpers. Balance lives on the UNIT (charges.unit_id), never on a
--    person — so deactivating/removing someone can't erase what's owed.
--    Positive = credit, negative = owes.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION unit_balance(p_unit UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT ROUND(
      COALESCE((SELECT SUM(amount_usd) FROM payments WHERE unit_id = p_unit), 0)
    - COALESCE((SELECT SUM(amount_usd) FROM charges  WHERE unit_id = p_unit), 0)
  , 2);
$$;

CREATE OR REPLACE FUNCTION user_outstanding(p_user UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(SUM(unit_balance(m.unit_id)), 0)
  FROM memberships m
  WHERE m.user_id = p_user AND m.ended_at IS NULL;
$$;

-- ------------------------------------------------------------
-- 6. Hierarchy helpers
-- ------------------------------------------------------------
-- Platform admin = 100, resident (no grants) = 10.
CREATE OR REPLACE FUNCTION user_max_rank(p_user UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT CASE
    WHEN COALESCE((SELECT is_platform_admin FROM profiles WHERE id = p_user), FALSE) THEN 100
    ELSE COALESCE((SELECT MAX(role_rank(g.role)) FROM grants g WHERE g.user_id = p_user), 10)
  END;
$$;

-- Every building a person touches (as resident OR as staff, incl. via org).
CREATE OR REPLACE FUNCTION user_footprint_buildings(p_user UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT DISTINCT b FROM (
    SELECT u.building_id AS b
      FROM memberships m JOIN units u ON u.id = m.unit_id
      WHERE m.user_id = p_user AND m.ended_at IS NULL
    UNION
    SELECT g.building_id
      FROM grants g
      WHERE g.user_id = p_user AND g.scope_type = 'building'
    UNION
    SELECT ob.building_id
      FROM grants g JOIN org_buildings ob ON ob.org_id = g.org_id
      WHERE g.user_id = p_user AND g.scope_type = 'org'
  ) s WHERE b IS NOT NULL;
$$;

-- Does this person hold an admin grant over this building?
CREATE OR REPLACE FUNCTION user_admins_building(p_user UUID, p_building UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM grants g
    WHERE g.user_id = p_user
      AND g.role IN ('building_admin','org_admin')
      AND (
        (g.scope_type = 'building' AND g.building_id = p_building)
        OR (g.scope_type = 'org' AND EXISTS (
              SELECT 1 FROM org_buildings ob
              WHERE ob.org_id = g.org_id AND ob.building_id = p_building))
      )
  );
$$;

-- Anti-orphan: how many ACTIVE admins does this building still have?
CREATE OR REPLACE FUNCTION building_active_admin_count(p_building UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COUNT(DISTINCT g.user_id)::INT
  FROM grants g JOIN profiles p ON p.id = g.user_id
  WHERE p.status = 'active'
    AND g.role IN ('building_admin','org_admin')
    AND (
      (g.scope_type = 'building' AND g.building_id = p_building)
      OR (g.scope_type = 'org' AND EXISTS (
            SELECT 1 FROM org_buildings ob
            WHERE ob.org_id = g.org_id AND ob.building_id = p_building))
    );
$$;

-- ------------------------------------------------------------
-- 7. Grants ladder: you can only manage grants BELOW your own level.
--    org_admin(80) can mint building_admin(60); building_admin(60) can mint
--    finance(40)/viewer(20) but NOT another building_admin.
--    auth.uid() IS NULL => service-role/edge-function context (invite-user) => allowed.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION grants_hierarchy_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_role TEXT; v_caller_rank INT;
BEGIN
  IF auth.uid() IS NULL OR is_platform_admin() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN v_role := OLD.role; ELSE v_role := NEW.role; END IF;
  v_caller_rank := user_max_rank(auth.uid());

  IF role_rank(v_role) >= v_caller_rank THEN
    RAISE EXCEPTION 'You cannot manage a "%" grant — it is at or above your own level.', v_role
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS grants_hierarchy_guard_trg ON grants;
CREATE TRIGGER grants_hierarchy_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON grants
  FOR EACH ROW EXECUTE FUNCTION grants_hierarchy_guard();

-- ------------------------------------------------------------
-- 8. THE deactivation guard. Enforced on the TABLE, so it holds no matter
--    which path writes it (RPC, direct update, future code).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION profiles_deactivation_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE b UUID;
BEGIN
  -- Reactivation: clear the audit trail.
  IF NEW.status IS DISTINCT FROM 'inactive' AND OLD.status = 'inactive' THEN
    NEW.deactivated_at := NULL;
    NEW.deactivated_by := NULL;
    NEW.deactivation_reason := NULL;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'inactive' OR OLD.status = 'inactive' THEN
    RETURN NEW;  -- not a deactivation
  END IF;

  -- Service-role / edge-function context: trusted, skip caller checks.
  IF auth.uid() IS NOT NULL THEN
    IF NEW.id = auth.uid() THEN
      RAISE EXCEPTION 'You cannot deactivate your own account.' USING ERRCODE = '42501';
    END IF;

    IF NOT is_platform_admin() THEN
      IF COALESCE((SELECT is_platform_admin FROM profiles WHERE id = NEW.id), FALSE) THEN
        RAISE EXCEPTION 'You cannot deactivate a platform admin.' USING ERRCODE = '42501';
      END IF;

      IF user_max_rank(NEW.id) >= user_max_rank(auth.uid()) THEN
        RAISE EXCEPTION 'You cannot deactivate someone at or above your own level.'
          USING ERRCODE = '42501';
      END IF;

      -- Must have authority over EVERY building they touch, or you could kill
      -- the login of someone who also works in a building you don't manage.
      FOR b IN SELECT * FROM user_footprint_buildings(NEW.id) LOOP
        IF NOT user_can(b, 'user.deactivate') THEN
          RAISE EXCEPTION 'That person also belongs to a building you do not manage.'
            USING ERRCODE = '42501';
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Anti-orphaning: never leave a building with no active admin.
  FOR b IN SELECT * FROM user_footprint_buildings(NEW.id) LOOP
    IF user_admins_building(NEW.id, b) AND building_active_admin_count(b) <= 1 THEN
      RAISE EXCEPTION 'That person is the last active admin of a building — assign another admin first.'
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  NEW.deactivated_at := COALESCE(NEW.deactivated_at, NOW());
  NEW.deactivated_by := COALESCE(NEW.deactivated_by, auth.uid());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_deactivation_guard_trg ON profiles;
CREATE TRIGGER profiles_deactivation_guard_trg
  BEFORE UPDATE OF status ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_deactivation_guard();

-- ------------------------------------------------------------
-- 9. Convenience RPCs (the trigger above does the actual enforcing)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION deactivate_user(p_target UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE profiles
     SET status = 'inactive', deactivation_reason = p_reason
   WHERE id = p_target;
END;
$$;

CREATE OR REPLACE FUNCTION reactivate_user(p_target UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE profiles SET status = 'active' WHERE id = p_target;
END;
$$;

-- Move-out: soft-end residency. The unit keeps its full ledger.
CREATE OR REPLACE FUNCTION end_membership(p_membership UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_building UUID;
BEGIN
  SELECT u.building_id INTO v_building
    FROM memberships m JOIN units u ON u.id = m.unit_id
   WHERE m.id = p_membership;

  IF v_building IS NULL THEN
    RAISE EXCEPTION 'Membership not found.' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NOT NULL AND NOT user_can(v_building, 'resident.manage') THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;

  UPDATE memberships SET ended_at = NOW() WHERE id = p_membership AND ended_at IS NULL;
END;
$$;

-- ------------------------------------------------------------
-- 10. Hard delete — platform admin ONLY, and only when it's safe.
--     can_delete_user() returns the list of blockers ('{}' = deletable),
--     so the UI can explain WHY instead of just failing.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION can_delete_user(p_target UUID)
RETURNS TEXT[] LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_blockers TEXT[] := '{}';
  r RECORD;
BEGIN
  IF NOT is_platform_admin() THEN
    RETURN ARRAY['Only the platform admin can delete an account.'];
  END IF;

  IF p_target = auth.uid() THEN
    v_blockers := v_blockers || 'You cannot delete your own account.';
  END IF;

  -- Revoke access first: keeps deletion from silently orphaning a building.
  IF EXISTS (SELECT 1 FROM grants WHERE user_id = p_target) THEN
    v_blockers := v_blockers || 'Revoke their management access first.';
  END IF;

  -- Never delete someone while their unit still owes (or is owed) money.
  FOR r IN
    SELECT u.label, unit_balance(m.unit_id) AS bal
      FROM memberships m JOIN units u ON u.id = m.unit_id
     WHERE m.user_id = p_target AND m.ended_at IS NULL
  LOOP
    IF r.bal < 0 THEN
      v_blockers := v_blockers || format('Unit %s owes %s — settle or write it off first.',
                                          r.label, to_char(abs(r.bal), 'FM999999990.00'));
    ELSIF r.bal > 0 THEN
      v_blockers := v_blockers || format('Unit %s is in credit %s — refund or clear it first.',
                                          r.label, to_char(r.bal, 'FM999999990.00'));
    END IF;
  END LOOP;

  RETURN v_blockers;
END;
$$;

CREATE OR REPLACE FUNCTION delete_user(p_target UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_blockers TEXT[];
BEGIN
  v_blockers := can_delete_user(p_target);
  IF COALESCE(array_length(v_blockers, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Cannot delete: %', array_to_string(v_blockers, ' ') USING ERRCODE = '42501';
  END IF;
  -- cascades: auth.users → profiles → memberships/grants.
  -- Financial history survives (charges/payments are unit-anchored; audit FKs
  -- below are SET NULL).
  DELETE FROM auth.users WHERE id = p_target;
END;
$$;

-- ------------------------------------------------------------
-- 11. Let history outlive the person.
--     created_by/reported_by were NOT NULL + NO ACTION, which made a hard
--     delete impossible. Relax to nullable + ON DELETE SET NULL so records
--     survive as "deleted user" rather than blocking the delete.
-- ------------------------------------------------------------
DO $$
DECLARE
  t RECORD;
  v_con TEXT;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('expenses','created_by'), ('charges','created_by'), ('payments','recorded_by'),
      ('inspections','created_by'), ('service_contracts','created_by'),
      ('dues','created_by'), ('dues_plans','created_by'),
      ('meetings','created_by'), ('issues','reported_by'),
      ('billing_entries','created_by')
    ) AS x(tbl, col)
  LOOP
    IF to_regclass(t.tbl) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t.tbl AND column_name = t.col
    ) THEN CONTINUE; END IF;

    -- allow NULL (required for ON DELETE SET NULL)
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP NOT NULL', t.tbl, t.col);

    -- find the existing FK on this column pointing at profiles
    SELECT con.conname INTO v_con
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.contype = 'f'
       AND rel.relname = t.tbl
       AND att.attname = t.col
       AND con.confrelid = 'profiles'::regclass
     LIMIT 1;

    IF v_con IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t.tbl, v_con);
    END IF;

    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES profiles(id) ON DELETE SET NULL',
      t.tbl, t.tbl || '_' || t.col || '_fkey', t.col);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 12. Grants
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION deactivate_user(UUID, TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION reactivate_user(UUID)        TO authenticated;
GRANT EXECUTE ON FUNCTION end_membership(UUID)         TO authenticated;
GRANT EXECUTE ON FUNCTION can_delete_user(UUID)        TO authenticated;
GRANT EXECUTE ON FUNCTION delete_user(UUID)            TO authenticated;
GRANT EXECUTE ON FUNCTION unit_balance(UUID)           TO authenticated;
GRANT EXECUTE ON FUNCTION user_outstanding(UUID)       TO authenticated;

COMMIT;

-- ------------------------------------------------------------
-- Post-run sanity checks (optional — run separately, read-only):
--
--   -- building_admin must NOT have org.manage anymore, org_admin must:
--   SELECT role_has_cap('building_admin','org.manage') AS should_be_false,
--          role_has_cap('org_admin','org.manage')      AS should_be_true,
--          role_has_cap('building_admin','user.deactivate') AS should_be_true;
--
--   -- no residency was lost (ended_at is NULL for every existing row):
--   SELECT count(*) FILTER (WHERE ended_at IS NULL) AS active,
--          count(*)                                  AS total
--     FROM memberships;
-- ------------------------------------------------------------
