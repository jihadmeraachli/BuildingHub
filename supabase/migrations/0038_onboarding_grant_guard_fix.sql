-- ============================================================
-- 0038_onboarding_grant_guard_fix.sql
-- Follow-up to 0037. Next guard in the chain: grants_hierarchy_guard (0026)
-- blocks managing grants at/above your own level. A self-registering admin has
-- NO grants (rank 0), so the auto-grant trigger (0031) inserting their
-- building_admin/compound_admin/org_admin grant is rejected:
--   'You cannot manage a "org_admin" grant — it is at or above your own level.'
--
-- Fix: honor the same transaction-local onboarding flag (abniyah.onboarding,
-- set by complete_admin_onboarding in 0037) — but ONLY for inserting a grant
-- for YOURSELF. Everything else stays locked:
--   - outside onboarding: ladder enforced exactly as before
--   - during onboarding: you still can't touch anyone else's grants, and
--     UPDATE/DELETE stay guarded
--
-- Additive & idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION grants_hierarchy_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_role TEXT; v_caller_rank INT;
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

-- ============================================================
-- Post-run checks:
--   -- 1. Ladder still enforced outside onboarding (as a building_admin in the
--   --    app console): inserting an org_admin grant must still fail.
--   -- 2. Registration wizard now completes end-to-end.
-- ============================================================
