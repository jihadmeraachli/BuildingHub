-- ============================================================
-- 0157_money_hardening.sql
-- Findings of the 2026-08-28 finance review (two-auditor pass over the
-- 0153-0156 arc) - the SQL-side fixes. All small, none behavioral for
-- clean data.
--
-- 1. LBP pair CHECKs also demand rate > 0. A row with amount_lbp set and
--    lbp_rate = 0 passed the old NULL-pair checks; the drawer math then
--    NULLIFs the rate, so the SAME money appeared fully in cash_usd AND
--    raw in cash_lbp. Client forms already block it - this closes the
--    direct-API door. (funds already had the > 0 guard from 0153.)
-- 2. expenses.paid_from_building_id must be a block of the expense's OWN
--    compound (trigger - a CHECK can't cross tables). Closes the
--    drawer-attribution stray flagged by both the security and finance
--    reviews: without it, a hand-written insert could point another
--    scope's fund_position at this expense.
-- 3. poll_results: the eligible-weight denominator now floors each unit's
--    share at 0.0001 exactly like cast_vote does, so a building with
--    zero-share units can no longer show turnout > 100%.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;
SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------------------
-- 1. rate > 0 in every LBP pair.
-- ------------------------------------------------------------
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_lbp_pair_chk;
ALTER TABLE payments ADD  CONSTRAINT payments_lbp_pair_chk
  CHECK (((amount_lbp IS NULL) = (lbp_rate IS NULL)) AND (lbp_rate IS NULL OR lbp_rate > 0));
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_lbp_pair_chk;
ALTER TABLE expenses ADD  CONSTRAINT expenses_lbp_pair_chk
  CHECK (((amount_lbp IS NULL) = (lbp_rate IS NULL)) AND (lbp_rate IS NULL OR lbp_rate > 0));
ALTER TABLE fund_entries DROP CONSTRAINT IF EXISTS fund_entries_lbp_pair;
ALTER TABLE fund_entries ADD  CONSTRAINT fund_entries_lbp_pair
  CHECK (((amount_lbp IS NULL) = (lbp_rate IS NULL)) AND (lbp_rate IS NULL OR lbp_rate > 0));
ALTER TABLE adjustments DROP CONSTRAINT IF EXISTS adjustments_lbp_pair_chk;
ALTER TABLE adjustments ADD  CONSTRAINT adjustments_lbp_pair_chk
  CHECK (((amount_lbp IS NULL) = (lbp_rate IS NULL)) AND (lbp_rate IS NULL OR lbp_rate > 0));

-- ------------------------------------------------------------
-- 2. paid_from_building_id stays inside the expense's own compound.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION expenses_paid_from_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.paid_from_building_id IS NOT NULL THEN
    IF NEW.compound_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM buildings b
      WHERE b.id = NEW.paid_from_building_id AND b.compound_id = NEW.compound_id) THEN
      RAISE EXCEPTION 'paid_from_building_id must be a block of the expense''s own compound.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_expenses_paid_from_guard ON expenses;
CREATE TRIGGER trg_expenses_paid_from_guard BEFORE INSERT OR UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION expenses_paid_from_guard();

-- ------------------------------------------------------------
-- 3. poll_results: eligible weight floors shares like cast_vote does.
--    Body is 0155's verbatim + GREATEST in the one_per_unit/by_share
--    eligible sum. (Signature unchanged - CREATE OR REPLACE suffices.)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION poll_results(p_poll UUID)
RETURNS TABLE(
  option_id     UUID,
  label         TEXT,
  votes         INT,
  vote_weight   NUMERIC,
  eligible      NUMERIC,
  cast_count    NUMERIC,
  cast_weight   NUMERIC,
  hidden        BOOLEAN
) LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_poll     polls;
  v_bids     UUID[];
  v_hidden   BOOLEAN;
  v_eligible NUMERIC;
  v_cast     NUMERIC;
  v_castw    NUMERIC;
BEGIN
  SELECT * INTO v_poll FROM polls WHERE id = p_poll;
  IF v_poll.id IS NULL OR NOT poll_in_scope(v_poll.building_id, v_poll.compound_id) THEN RETURN; END IF;
  v_bids := poll_building_ids(v_poll);
  v_hidden := v_poll.results_visibility = 'after_close'
    AND v_poll.status = 'open' AND now() < v_poll.closes_at
    AND NOT poll_can_manage(v_poll.building_id, v_poll.compound_id);

  -- who could vote (0157: by_share floors each unit's weight like cast_vote)
  IF v_poll.eligibility = 'one_per_unit' THEN
    SELECT CASE WHEN v_poll.weighting = 'by_share'
        THEN COALESCE(SUM(GREATEST(u.share_weight, 0.0001)), 0) ELSE COUNT(*) END
      INTO v_eligible
    FROM units u
    WHERE u.building_id = ANY(v_bids)
      AND EXISTS (SELECT 1 FROM memberships m WHERE m.unit_id = u.id AND m.ended_at IS NULL);
  ELSE
    SELECT COUNT(DISTINCT m.user_id) INTO v_eligible
    FROM memberships m JOIN units u ON u.id = m.unit_id
    WHERE u.building_id = ANY(v_bids) AND m.ended_at IS NULL
      AND (v_poll.eligibility <> 'owners_only' OR m.tenure = 'owner');
  END IF;

  -- turnout: distinct ballots (a multi-choice ballot counts once; a ballot's
  -- weight counts once even when it spans several options)
  SELECT COUNT(*), COALESCE(SUM(b.w), 0) INTO v_cast, v_castw FROM (
    SELECT MAX(v.weight) AS w FROM poll_votes v WHERE v.poll_id = p_poll
    GROUP BY COALESCE(v.unit_id, v.user_id)) b;

  RETURN QUERY
  SELECT po.id, po.label,
         CASE WHEN v_hidden THEN NULL ELSE COALESCE(cnt.n, 0)::int END,
         CASE WHEN v_hidden THEN NULL ELSE COALESCE(cnt.w, 0) END,
         v_eligible, v_cast, v_castw, v_hidden
  FROM poll_options po
  LEFT JOIN (SELECT v.option_id AS oid, COUNT(*) AS n, SUM(v.weight) AS w
               FROM poll_votes v WHERE v.poll_id = p_poll AND NOT v.abstain
              GROUP BY v.option_id) cnt ON cnt.oid = po.id
  WHERE po.poll_id = p_poll
  UNION ALL
  SELECT NULL, 'abstain',
         CASE WHEN v_hidden THEN NULL ELSE COALESCE(ab.n, 0)::int END,
         CASE WHEN v_hidden THEN NULL ELSE COALESCE(ab.w, 0) END,
         v_eligible, v_cast, v_castw, v_hidden
  FROM (SELECT COUNT(*) AS n, SUM(weight) AS w FROM poll_votes
         WHERE poll_id = p_poll AND abstain) ab;
END;
$$;
GRANT EXECUTE ON FUNCTION poll_results(UUID) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks (SQL Editor):
--   1. INSERT a payment with amount_lbp = 1000, lbp_rate = 0 → CHECK refuses.
--   2. UPDATE an expense setting paid_from_building_id to a building of
--      another compound → trigger refuses; to a block of its own compound → ok.
--   3. On a by_share poll in a building with a zero-share unit,
--      poll_results.eligible now includes the 0.0001 floor (turnout ≤ 100%).
--
-- Known-and-accepted (documented, not bugs):
--   - cash vs (cash_usd + rated LBP) agree only to rounding cents (≤1¢ per
--     LBP row, from 0086's per-row compose rounding). Nothing compares them
--     for equality; do not add such an assert.
--   - fund_position().unattributed is a per-compound count, identical in
--     every single-block call - never sum it across blocks.
-- ============================================================
