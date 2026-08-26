-- ============================================================
-- 0151_invite_accept_activation.sql
-- INVITE FLOW CHANGE (Jey, 2026-08-26): an invited user now stays PENDING
-- until they actually accept the invitation and sign in for the first time.
--
--   OLD: invite-user created the profile status='active' immediately - and the
--        profile upsert (pending->active over the auth-trigger row) fired the
--        "you have been approved to <building>" email, with building '—' on
--        imports. Nobody had accepted anything yet.
--   NEW: invite-user creates status='pending'. On the invitee's FIRST sign-in
--        the app calls activate_invited_account(): if (and only if) the
--        account shows EVIDENCE OF AN INVITATION - a home building set by the
--        inviter, a grant, or a membership - it self-activates through the
--        0037-sanctioned flag. No approval email (the redundant one is removed
--        from dynamic-action in the same change).
--
-- The stranger gate survives intact: a raw API signup has no building, no
-- grant, no membership - this function returns FALSE for them and they stay
-- pending forever, exactly as before.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION activate_invited_account()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_p RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RETURN FALSE; END IF;
  SELECT * INTO v_p FROM profiles WHERE id = auth.uid();
  IF v_p IS NULL OR v_p.status <> 'pending' THEN RETURN FALSE; END IF;

  -- Evidence this account was INVITED (set only by sanctioned paths):
  --   a home building stamped by invite-user, a management grant, or a
  --   residency membership. A stray self-signup has none of these.
  IF v_p.building_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM grants g WHERE g.user_id = auth.uid())
     AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = auth.uid()) THEN
    RETURN FALSE;
  END IF;

  -- The 0037 guard's sanctioned exception: the transaction-local onboarding
  -- flag permits exactly this self-activation and nothing else.
  PERFORM set_config('abniyah.onboarding', '1', true);
  UPDATE profiles SET status = 'active' WHERE id = auth.uid();
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION activate_invited_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION activate_invited_account() TO authenticated;

COMMIT;

-- Post-run checks:
--   Invite someone (any role) -> they appear under Invitations as "awaiting
--     first sign-in" (status pending); they accept the email link and land in
--     the app -> status flips to active on its own, NO approval email.
--   Create a raw account straight against the auth API -> stays pending;
--     activate_invited_account() returns FALSE for it (no invite evidence).
