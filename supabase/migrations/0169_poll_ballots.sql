-- ============================================================
-- 0169_poll_ballots.sql
-- "Who voted what" for OPEN (non-anonymous) ballots (Jey, 31 Aug).
--
-- The roll call a committee needs: every eligible voter with their choice,
-- their abstention, or the fact that they have not voted yet.
--
-- PRIVACY IS NOT NEGOTIABLE. This mirrors the poll_votes RLS exactly:
--   * a SECRET ballot returns NOTHING - to anyone, manager or platform
--     admin, while open and forever after. Secrecy is a promise made when
--     the vote was created; closing it never reveals identities.
--   * an OPEN ballot returns rows only to managers of the poll's scope.
-- Residents calling this get an empty set, so the client cannot leak it.
--
-- The eligible set mirrors poll_results() so the roll call and the turnout
-- figure can never disagree:
--   one_per_unit  -> one row per unit with a live membership; the expected
--                    voter is the owner, or the tenant when no owner is
--                    linked (cast_vote's own rule).
--   all_residents -> one row per person with a live membership in scope.
--   owners_only   -> the same, restricted to owner memberships.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION poll_ballots(p_poll UUID)
RETURNS TABLE(
  voter_id   UUID,
  voter_name TEXT,
  unit_label TEXT,
  status     TEXT,        -- 'voted' | 'abstained' | 'pending'
  choices    TEXT[],      -- option labels (empty when abstained/pending)
  weight     NUMERIC,
  voted_at   TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_poll polls;
  v_bids UUID[];
BEGIN
  SELECT * INTO v_poll FROM polls WHERE id = p_poll;
  IF v_poll.id IS NULL THEN RETURN; END IF;
  IF v_poll.anonymous OR NOT poll_can_manage(v_poll.building_id, v_poll.compound_id) THEN RETURN; END IF;
  v_bids := poll_building_ids(v_poll);

  IF v_poll.eligibility = 'one_per_unit' THEN
    RETURN QUERY
    WITH elig AS (
      SELECT u.id, u.label, u.share_weight
      FROM units u
      WHERE u.building_id = ANY(v_bids)
        AND EXISTS (SELECT 1 FROM memberships m WHERE m.unit_id = u.id AND m.ended_at IS NULL)
    ),
    rep AS (   -- who is expected to speak for the unit: owner outranks tenant
      SELECT DISTINCT ON (m.unit_id) m.unit_id, m.user_id
      FROM memberships m
      WHERE m.ended_at IS NULL AND m.unit_id IN (SELECT e.id FROM elig e)
      ORDER BY m.unit_id, (m.tenure = 'owner') DESC, m.created_at
    ),
    b AS (
      SELECT v.unit_id,
             bool_or(v.abstain)                                            AS abstained,
             array_remove(array_agg(po.label ORDER BY po.position), NULL)   AS labels,
             max(v.weight)                                                 AS w,
             min(v.created_at)                                             AS at,
             (array_agg(v.user_id))[1]                                     AS by_user
      FROM poll_votes v
      LEFT JOIN poll_options po ON po.id = v.option_id
      WHERE v.poll_id = p_poll AND v.unit_id IS NOT NULL
      GROUP BY v.unit_id
    )
    SELECT
      COALESCE(b.by_user, rep.user_id),
      COALESCE(pr.full_name, ''),
      e.label,
      CASE WHEN b.unit_id IS NULL THEN 'pending'
           WHEN b.abstained       THEN 'abstained'
           ELSE 'voted' END,
      COALESCE(b.labels, '{}'::TEXT[]),
      COALESCE(b.w, CASE WHEN v_poll.weighting = 'by_share' THEN e.share_weight ELSE 1 END),
      b.at
    FROM elig e
    LEFT JOIN rep      ON rep.unit_id = e.id
    LEFT JOIN b        ON b.unit_id   = e.id
    LEFT JOIN profiles pr ON pr.id = COALESCE(b.by_user, rep.user_id)
    ORDER BY e.label;
  ELSE
    RETURN QUERY
    WITH elig AS (
      SELECT DISTINCT m.user_id
      FROM memberships m JOIN units u ON u.id = m.unit_id
      WHERE u.building_id = ANY(v_bids) AND m.ended_at IS NULL
        AND (v_poll.eligibility <> 'owners_only' OR m.tenure = 'owner')
    ),
    un AS (   -- the units that person is linked to, for context
      SELECT m.user_id, string_agg(DISTINCT u.label, ', ') AS labels
      FROM memberships m JOIN units u ON u.id = m.unit_id
      WHERE u.building_id = ANY(v_bids) AND m.ended_at IS NULL
      GROUP BY m.user_id
    ),
    b AS (
      SELECT v.user_id,
             bool_or(v.abstain)                                          AS abstained,
             array_remove(array_agg(po.label ORDER BY po.position), NULL) AS labels,
             min(v.created_at)                                           AS at
      FROM poll_votes v
      LEFT JOIN poll_options po ON po.id = v.option_id
      WHERE v.poll_id = p_poll AND v.unit_id IS NULL
      GROUP BY v.user_id
    )
    SELECT
      e.user_id,
      COALESCE(pr.full_name, ''),
      COALESCE(un.labels, ''),
      CASE WHEN b.user_id IS NULL THEN 'pending'
           WHEN b.abstained       THEN 'abstained'
           ELSE 'voted' END,
      COALESCE(b.labels, '{}'::TEXT[]),
      1::NUMERIC,
      b.at
    FROM elig e
    LEFT JOIN un       ON un.user_id = e.user_id
    LEFT JOIN b        ON b.user_id  = e.user_id
    LEFT JOIN profiles pr ON pr.id = e.user_id
    ORDER BY COALESCE(pr.full_name, ''), COALESCE(un.labels, '');
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION poll_ballots(UUID) TO authenticated;

COMMIT;

-- Post-run checks:
--   1. SELECT * FROM poll_ballots('<open-ballot poll>')  as a manager
--      -> every eligible voter, with 'voted' + choices, 'abstained', or
--         'pending'; the row count matches the turnout denominator.
--   2. The same call on a SECRET ballot -> 0 rows, for everyone.
--   3. The same call as a resident -> 0 rows.
