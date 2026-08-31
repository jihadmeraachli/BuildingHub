-- ============================================================
-- 0168_vote_by_email.sql
-- One-click voting from the email (Jey, 31 Aug). The vote-click edge
-- function verifies an HMAC-signed link and casts on the user's behalf.
--
-- Rather than duplicating cast_vote's rules (eligibility, owner-outranks-
-- tenant, revote-replaces, windows, share weights), this wrapper makes
-- auth.uid() resolve to the link's user for the duration of the call and
-- delegates to cast_vote itself. set_config(..., true) is transaction-
-- local, so nothing leaks.
--
-- service_role ONLY - clients never see it.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION cast_vote_as(p_user UUID, p_poll UUID, p_option_ids UUID[], p_abstain BOOLEAN DEFAULT FALSE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'No user.' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', p_user, 'role', 'authenticated')::text,
                     true);
  PERFORM cast_vote(p_poll, p_option_ids, p_abstain);
END;
$$;

REVOKE ALL ON FUNCTION cast_vote_as(UUID, UUID, UUID[], BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION cast_vote_as(UUID, UUID, UUID[], BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION cast_vote_as(UUID, UUID, UUID[], BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION cast_vote_as(UUID, UUID, UUID[], BOOLEAN) TO service_role;

COMMIT;

-- Post-run check: as service role,
--   SELECT cast_vote_as('<resident uuid>', '<open poll uuid>', ARRAY['<option uuid>']);
-- -> a poll_votes row for that user; as a normal user the call is refused.
