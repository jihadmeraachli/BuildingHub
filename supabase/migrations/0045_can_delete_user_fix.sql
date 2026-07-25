-- ============================================================
-- 0045_can_delete_user_fix.sql
-- Bug: can_delete_user (0026) appended untyped string literals to a TEXT[]
-- with the || operator. Postgres resolves  text[] || 'unknown literal'  as
-- array-concat and tries to parse the sentence AS an array →
--   malformed array literal: "Revoke their management access first."
-- (The format()-built blockers were fine — typed TEXT picks array_append.)
--
-- Fix: use array_append explicitly everywhere. Behavior unchanged.
-- Additive & idempotent.
-- ============================================================

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
    v_blockers := array_append(v_blockers, 'You cannot delete your own account.');
  END IF;

  -- Revoke access first: keeps deletion from silently orphaning a building.
  IF EXISTS (SELECT 1 FROM grants WHERE user_id = p_target) THEN
    v_blockers := array_append(v_blockers, 'Revoke their management access first.');
  END IF;

  -- Never delete someone while their unit still owes (or is owed) money.
  FOR r IN
    SELECT u.label, unit_balance(m.unit_id) AS bal
      FROM memberships m JOIN units u ON u.id = m.unit_id
     WHERE m.user_id = p_target AND m.ended_at IS NULL
  LOOP
    IF r.bal < 0 THEN
      v_blockers := array_append(v_blockers, format('Unit %s owes %s — settle or write it off first.',
                                          r.label, to_char(abs(r.bal), 'FM999999990.00')));
    ELSIF r.bal > 0 THEN
      v_blockers := array_append(v_blockers, format('Unit %s is in credit %s — refund or clear it first.',
                                          r.label, to_char(r.bal, 'FM999999990.00')));
    END IF;
  END LOOP;

  RETURN v_blockers;
END;
$$;

GRANT EXECUTE ON FUNCTION can_delete_user(UUID) TO authenticated;

-- ============================================================
-- Post-run check:
--   SELECT can_delete_user('<uuid-with-a-grant>');
--   -- expect: {"Revoke their management access first."} — no malformed-array error
-- ============================================================
