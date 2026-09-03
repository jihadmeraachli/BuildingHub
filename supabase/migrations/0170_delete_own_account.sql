-- ============================================================
-- 0170_delete_own_account.sql
-- Self-service account deletion (App Store requirement, 3 Sep).
--
-- Apple Guideline 5.1.1(v): an app with accounts must let the user initiate
-- account deletion from INSIDE the app. delete_user() (0026) is platform-
-- admin-only; this is the self-scoped counterpart with the same protections,
-- rephrased for the person deleting their own account:
--   * a platform owner cannot self-delete (protects the operator account),
--   * management grants must be removed first (no silently orphaned
--     buildings),
--   * every linked unit's balance must be exactly zero (owed or in credit
--     both block - money questions outlive logins).
-- Deletion cascades auth.users -> profiles -> memberships/grants/device
-- tokens; building financial history is unit-anchored and survives, with
-- created_by/recorded_by style columns going NULL (0026's SET NULL work).
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION can_delete_own_account()
RETURNS TEXT[] LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_blockers TEXT[] := '{}';
  r RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RETURN ARRAY['Not signed in.'];
  END IF;

  IF is_platform_admin() THEN
    v_blockers := v_blockers || 'Platform owner accounts cannot be deleted from the app.';
  END IF;

  IF EXISTS (SELECT 1 FROM grants WHERE user_id = v_uid) THEN
    v_blockers := v_blockers || 'You still hold management access — ask another administrator to remove your roles first.';
  END IF;

  FOR r IN
    SELECT u.label, unit_balance(m.unit_id) AS bal
      FROM memberships m JOIN units u ON u.id = m.unit_id
     WHERE m.user_id = v_uid AND m.ended_at IS NULL
  LOOP
    IF r.bal < 0 THEN
      v_blockers := v_blockers || format('Unit %s owes %s — settle it first.',
                                          r.label, to_char(abs(r.bal), 'FM999999990.00'));
    ELSIF r.bal > 0 THEN
      v_blockers := v_blockers || format('Unit %s is in credit %s — ask for a refund or clearance first.',
                                          r.label, to_char(r.bal, 'FM999999990.00'));
    END IF;
  END LOOP;

  RETURN v_blockers;
END;
$$;

CREATE OR REPLACE FUNCTION delete_own_account()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_blockers TEXT[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501';
  END IF;
  v_blockers := can_delete_own_account();
  IF COALESCE(array_length(v_blockers, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Cannot delete: %', array_to_string(v_blockers, ' ') USING ERRCODE = '42501';
  END IF;
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION can_delete_own_account() TO authenticated;
GRANT EXECUTE ON FUNCTION delete_own_account()    TO authenticated;

COMMIT;

-- Post-run checks:
--   1. A resident with a zero balance and no roles: Settings -> Delete my
--      account -> type email -> account gone, next login fails, their unit's
--      charges/payments still on the books with the person shown as removed.
--   2. A resident who owes money sees the blocker naming the unit and amount.
--   3. The platform owner sees the owner blocker.
