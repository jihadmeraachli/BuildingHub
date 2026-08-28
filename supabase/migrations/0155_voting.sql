-- ============================================================
-- 0155_voting.sql
-- Voting (Jey, 2026-08-28): the committee puts a question to the building.
--
-- WHO. Creating a vote is a new capability, poll.manage - admin roles only
-- (org/compound/building admin), per Jey: "only building admin can create".
-- Voting itself is for RESIDENTS (people with a membership in scope); every
-- resident gets an in-app notification when a vote opens.
--
-- SCOPE. A poll targets a whole compound or one block, like finance rows
-- (building_id XOR compound_id).
--
-- THE RULES ("initial setup") - the common condominium ballot options:
--   eligibility          all_residents | owners_only | one_per_unit
--                        (one_per_unit = the classic HOA ballot: each unit
--                        casts one vote, whoever of its people votes last)
--   weighting            per_person | by_share (by ownership share_weight -
--                        Lebanese co-ownership votes by the 2,400 shares;
--                        by_share forces per-unit ballots)
--   choice_type          single | multiple (+ max_choices)
--   anonymous            secret ballot (default) or open - open ballots let
--                        managers see who voted what; secret never stores...
--                        it stores voter ids (needed for one-vote-each) but
--                        NO ONE can read individual rows, only aggregates
--   allow_abstain        an explicit abstain counts toward quorum
--   quorum_pct           minimum turnout for the vote to be valid (0 = none)
--   pass_threshold_pct   share of cast (non-abstain) votes the winner needs
--                        (50 = simple majority, 66 = supermajority)
--   results_visibility   live | after_close (managers always see live)
--
-- DOORS. Votes are cast ONLY through cast_vote() (revocable until close,
-- validates eligibility/choices/window, computes weight); results ONLY
-- through poll_results() (aggregates, respects visibility). poll_votes has
-- no INSERT/UPDATE/DELETE policies at all - the RPCs are the doors.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;
SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------------------
-- 1. The capability. role_has_cap is 0110's body verbatim + poll.manage
--    for the admin roles. KEEP IN SYNC with src/lib/permissions.ts.
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
      'poll.manage',
      'user.deactivate')
    WHEN p_role IN ('compound_admin','building_admin') THEN p_cap IN (
      'building.manage','unit.manage','group.manage',
      'resident.approve','resident.manage','grant.manage',
      'issue.view_all','issue.update',
      'expense.manage','charge.manage','payment.record','payment.confirm','finance.view',
      'meeting.manage',
      'poll.manage',
      'user.deactivate')
    WHEN p_role IN ('building_finance','org_finance','compound_finance') THEN p_cap IN (
      'expense.manage','charge.manage','payment.record','payment.confirm','finance.view')
    WHEN p_role = 'building_super' THEN p_cap IN (
      'issue.view_all','issue.update','meeting.manage')
    -- the collector: writes receipts, sees nothing else (0110)
    WHEN p_role = 'building_collector' THEN p_cap IN ('payment.record')
    WHEN p_role = 'viewer' THEN p_cap IN ('finance.view','issue.view_all')
    ELSE FALSE
  END;
$$;

-- ------------------------------------------------------------
-- 2. Tables.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS polls (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id         UUID REFERENCES buildings(id) ON DELETE CASCADE,
  compound_id         UUID REFERENCES compounds(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT,
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closes_at           TIMESTAMPTZ NOT NULL,
  closed_at           TIMESTAMPTZ,
  anonymous           BOOLEAN NOT NULL DEFAULT TRUE,
  eligibility         TEXT NOT NULL DEFAULT 'all_residents'
                        CHECK (eligibility IN ('all_residents', 'owners_only', 'one_per_unit')),
  weighting           TEXT NOT NULL DEFAULT 'per_person'
                        CHECK (weighting IN ('per_person', 'by_share')),
  choice_type         TEXT NOT NULL DEFAULT 'single' CHECK (choice_type IN ('single', 'multiple')),
  max_choices         INT  NOT NULL DEFAULT 1 CHECK (max_choices >= 1),
  allow_abstain       BOOLEAN NOT NULL DEFAULT TRUE,
  quorum_pct          NUMERIC(5,2) NOT NULL DEFAULT 0  CHECK (quorum_pct >= 0 AND quorum_pct <= 100),
  pass_threshold_pct  NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (pass_threshold_pct > 0 AND pass_threshold_pct <= 100),
  results_visibility  TEXT NOT NULL DEFAULT 'live' CHECK (results_visibility IN ('live', 'after_close')),
  created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT polls_scope CHECK ((building_id IS NOT NULL) <> (compound_id IS NOT NULL)),
  -- weighting by share only makes sense on per-unit ballots
  CONSTRAINT polls_share_per_unit CHECK (weighting <> 'by_share' OR eligibility = 'one_per_unit')
);
CREATE INDEX IF NOT EXISTS polls_building_idx ON polls(building_id, created_at DESC);
CREATE INDEX IF NOT EXISTS polls_compound_idx ON polls(compound_id, created_at DESC);

CREATE TABLE IF NOT EXISTS poll_options (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id   UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label     TEXT NOT NULL,
  position  INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS poll_options_poll_idx ON poll_options(poll_id, position);

CREATE TABLE IF NOT EXISTS poll_votes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id    UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id  UUID REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  unit_id    UUID REFERENCES units(id) ON DELETE CASCADE,  -- per-unit ballots
  abstain    BOOLEAN NOT NULL DEFAULT FALSE,
  weight     NUMERIC(12,4) NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT poll_votes_option_or_abstain CHECK ((option_id IS NULL) = abstain)
);
CREATE INDEX IF NOT EXISTS poll_votes_poll_idx ON poll_votes(poll_id);
-- per-person ballots: one row per (poll,user,option); one abstain per user
CREATE UNIQUE INDEX IF NOT EXISTS poll_votes_person_opt_uidx
  ON poll_votes(poll_id, user_id, option_id) WHERE option_id IS NOT NULL AND unit_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS poll_votes_person_abs_uidx
  ON poll_votes(poll_id, user_id) WHERE abstain AND unit_id IS NULL;
-- per-unit ballots: one row per (poll,unit,option); one abstain per unit
CREATE UNIQUE INDEX IF NOT EXISTS poll_votes_unit_opt_uidx
  ON poll_votes(poll_id, unit_id, option_id) WHERE option_id IS NOT NULL AND unit_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS poll_votes_unit_abs_uidx
  ON poll_votes(poll_id, unit_id) WHERE abstain AND unit_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Helpers + RLS.
-- ------------------------------------------------------------
-- can the caller SEE this poll's scope? (member or any manager)
CREATE OR REPLACE FUNCTION poll_in_scope(p_building UUID, p_compound UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT is_platform_admin()
    OR (p_building IS NOT NULL AND (
          user_can(p_building, 'issue.view_all')
          OR user_member_building(p_building)))
    OR (p_compound IS NOT NULL AND EXISTS (
          SELECT 1 FROM buildings b WHERE b.compound_id = p_compound
            AND (user_can(b.id, 'issue.view_all') OR user_member_building(b.id))));
$$;
-- can the caller MANAGE polls here?
CREATE OR REPLACE FUNCTION poll_can_manage(p_building UUID, p_compound UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT is_platform_admin()
    OR (p_building IS NOT NULL AND user_can(p_building, 'poll.manage'))
    OR (p_compound IS NOT NULL AND EXISTS (
          SELECT 1 FROM buildings b WHERE b.compound_id = p_compound
            AND user_can(b.id, 'poll.manage')));
$$;

ALTER TABLE polls        ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_votes   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS polls_select ON polls;
CREATE POLICY polls_select ON polls FOR SELECT USING (poll_in_scope(building_id, compound_id));
DROP POLICY IF EXISTS polls_write ON polls;
CREATE POLICY polls_write ON polls FOR ALL
  USING (poll_can_manage(building_id, compound_id))
  WITH CHECK (poll_can_manage(building_id, compound_id));

DROP POLICY IF EXISTS poll_options_select ON poll_options;
CREATE POLICY poll_options_select ON poll_options FOR SELECT USING (
  EXISTS (SELECT 1 FROM polls p WHERE p.id = poll_id AND poll_in_scope(p.building_id, p.compound_id))
);
DROP POLICY IF EXISTS poll_options_write ON poll_options;
CREATE POLICY poll_options_write ON poll_options FOR ALL
  USING (EXISTS (SELECT 1 FROM polls p WHERE p.id = poll_id AND poll_can_manage(p.building_id, p.compound_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM polls p WHERE p.id = poll_id AND poll_can_manage(p.building_id, p.compound_id)));

-- poll_votes: your own rows always; other people's ONLY on open (non-anonymous)
-- ballots and only for managers. NO write policies - cast_vote() is the door.
DROP POLICY IF EXISTS poll_votes_select ON poll_votes;
CREATE POLICY poll_votes_select ON poll_votes FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM polls p WHERE p.id = poll_id
               AND NOT p.anonymous AND poll_can_manage(p.building_id, p.compound_id))
);

-- ------------------------------------------------------------
-- 4. The doors.
-- ------------------------------------------------------------
-- the buildings a poll spans
CREATE OR REPLACE FUNCTION poll_building_ids(p_poll polls)
RETURNS UUID[] LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_poll.building_id IS NOT NULL THEN ARRAY[p_poll.building_id]
    ELSE ARRAY(SELECT b.id FROM buildings b WHERE b.compound_id = p_poll.compound_id) END;
$$;

CREATE OR REPLACE FUNCTION cast_vote(p_poll UUID, p_option_ids UUID[], p_abstain BOOLEAN DEFAULT FALSE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_poll    polls;
  v_bids    UUID[];
  v_units   UUID[];
  v_n       INT;
  v_uid     UUID := auth.uid();
  v_unit    UUID;
  v_weight  NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_poll FROM polls WHERE id = p_poll FOR UPDATE;
  IF v_poll.id IS NULL THEN RAISE EXCEPTION 'Vote not found.' USING ERRCODE = '22023'; END IF;
  IF v_poll.status <> 'open' OR now() >= v_poll.closes_at THEN
    RAISE EXCEPTION 'This vote is closed.' USING ERRCODE = 'P0001';
  END IF;
  v_bids := poll_building_ids(v_poll);

  -- eligibility: a live membership in scope (owners_only -> tenure 'owner')
  SELECT array_agg(DISTINCT u.id) INTO v_units
  FROM memberships m JOIN units u ON u.id = m.unit_id
  WHERE m.user_id = v_uid AND m.ended_at IS NULL AND u.building_id = ANY(v_bids)
    AND (v_poll.eligibility <> 'owners_only' OR m.tenure = 'owner')
    AND (v_poll.eligibility <> 'one_per_unit' OR m.tenure = 'owner' OR NOT EXISTS (
          -- per-unit ballot: the owner outranks a tenant; a tenant votes the
          -- unit only when no owner is linked to it
          SELECT 1 FROM memberships mo WHERE mo.unit_id = u.id AND mo.tenure = 'owner' AND mo.ended_at IS NULL));
  IF v_units IS NULL THEN
    RAISE EXCEPTION 'Only residents of this scope can vote here.' USING ERRCODE = '42501';
  END IF;

  -- choices
  IF p_abstain THEN
    IF NOT v_poll.allow_abstain THEN RAISE EXCEPTION 'Abstaining is not allowed on this vote.' USING ERRCODE = 'P0001'; END IF;
    p_option_ids := '{}';
  ELSE
    v_n := COALESCE(array_length(p_option_ids, 1), 0);
    IF v_n = 0 THEN RAISE EXCEPTION 'Pick an option.' USING ERRCODE = '22023'; END IF;
    IF v_poll.choice_type = 'single' AND v_n <> 1 THEN
      RAISE EXCEPTION 'This vote takes exactly one choice.' USING ERRCODE = '22023';
    END IF;
    IF v_poll.choice_type = 'multiple' AND v_n > v_poll.max_choices THEN
      RAISE EXCEPTION 'At most % choices.', v_poll.max_choices USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(p_option_ids) o
               WHERE NOT EXISTS (SELECT 1 FROM poll_options po WHERE po.id = o AND po.poll_id = p_poll)) THEN
      RAISE EXCEPTION 'Unknown option.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_poll.eligibility = 'one_per_unit' THEN
    -- a ballot per unit the caller speaks for; revote replaces the unit's ballot
    FOREACH v_unit IN ARRAY v_units LOOP
      v_weight := CASE WHEN v_poll.weighting = 'by_share'
        THEN GREATEST((SELECT u.share_weight FROM units u WHERE u.id = v_unit), 0.0001) ELSE 1 END;
      DELETE FROM poll_votes WHERE poll_id = p_poll AND unit_id = v_unit;
      IF p_abstain THEN
        INSERT INTO poll_votes (poll_id, option_id, user_id, unit_id, abstain, weight)
        VALUES (p_poll, NULL, v_uid, v_unit, TRUE, v_weight);
      ELSE
        INSERT INTO poll_votes (poll_id, option_id, user_id, unit_id, abstain, weight)
        SELECT p_poll, o, v_uid, v_unit, FALSE, v_weight FROM unnest(p_option_ids) o;
      END IF;
    END LOOP;
  ELSE
    -- one ballot per person; revote replaces it
    DELETE FROM poll_votes WHERE poll_id = p_poll AND user_id = v_uid;
    IF p_abstain THEN
      INSERT INTO poll_votes (poll_id, option_id, user_id, abstain, weight)
      VALUES (p_poll, NULL, v_uid, TRUE, 1);
    ELSE
      INSERT INTO poll_votes (poll_id, option_id, user_id, abstain, weight)
      SELECT p_poll, o, v_uid, FALSE, 1 FROM unnest(p_option_ids) o;
    END IF;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION cast_vote(UUID, UUID[], BOOLEAN) TO authenticated;

-- Aggregate results. Hidden-until-close ballots return NULL per-option counts
-- to non-managers while open; turnout is always visible.
CREATE OR REPLACE FUNCTION poll_results(p_poll UUID)
RETURNS TABLE(
  option_id     UUID,      -- NULL row = the abstain bucket
  label         TEXT,
  votes         INT,       -- NULL while results are hidden
  vote_weight   NUMERIC,   -- NULL while results are hidden
  eligible      NUMERIC,   -- voters (or units / total shares) who COULD vote
  cast_count    NUMERIC,   -- ballots cast (people or units, incl. abstains)
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

  -- who could vote
  IF v_poll.eligibility = 'one_per_unit' THEN
    SELECT CASE WHEN v_poll.weighting = 'by_share'
        THEN COALESCE(SUM(u.share_weight), 0) ELSE COUNT(*) END
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

-- Close now (managers). Late results also auto-hide-expire via closes_at.
CREATE OR REPLACE FUNCTION close_poll(p_poll UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_poll polls;
BEGIN
  SELECT * INTO v_poll FROM polls WHERE id = p_poll FOR UPDATE;
  IF v_poll.id IS NULL THEN RAISE EXCEPTION 'Vote not found.' USING ERRCODE = '22023'; END IF;
  IF NOT poll_can_manage(v_poll.building_id, v_poll.compound_id) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  UPDATE polls SET status = 'closed', closed_at = now() WHERE id = p_poll AND status = 'open';
END;
$$;
GRANT EXECUTE ON FUNCTION close_poll(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 5. Notifications: vote opened -> every resident in scope (not the creator);
--    vote closed -> same crowd.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_on_poll() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_bids UUID[];
BEGIN
  v_bids := poll_building_ids(NEW);
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT DISTINCT m.user_id, u.building_id, 'poll_opened',
         'New vote', NEW.title || ' — voting is open. Have your say.'
  FROM memberships m JOIN units u ON u.id = m.unit_id
  WHERE u.building_id = ANY(v_bids) AND m.ended_at IS NULL
    AND m.user_id <> COALESCE(NEW.created_by, '00000000-0000-0000-0000-000000000000'::uuid);
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_poll ON polls;
CREATE TRIGGER trg_notify_poll AFTER INSERT ON polls
  FOR EACH ROW EXECUTE FUNCTION notify_on_poll();

CREATE OR REPLACE FUNCTION notify_on_poll_close() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_bids UUID[];
BEGIN
  IF OLD.status = 'open' AND NEW.status = 'closed' THEN
    v_bids := poll_building_ids(NEW);
    INSERT INTO notifications (user_id, building_id, type, title, body)
    SELECT DISTINCT m.user_id, u.building_id, 'poll_closed',
           'Vote closed', NEW.title || ' — the results are in.'
    FROM memberships m JOIN units u ON u.id = m.unit_id
    WHERE u.building_id = ANY(v_bids) AND m.ended_at IS NULL;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_poll_close ON polls;
CREATE TRIGGER trg_notify_poll_close AFTER UPDATE ON polls
  FOR EACH ROW EXECUTE FUNCTION notify_on_poll_close();

COMMIT;

-- ============================================================
-- Post-run checks (SQL Editor):
--   1. As building admin: INSERT a poll + options → residents get
--      'poll_opened'; as a resident INSERT → RLS refuses (poll.manage).
--   2. cast_vote as a resident → row lands; revote → replaced; after
--      closes_at → 'This vote is closed.'; non-resident → refused.
--   3. one_per_unit + by_share: two co-owners of one unit vote → ONE ballot
--      (the later replaces), weight = the unit's share_weight.
--   4. anonymous poll: manager SELECT * FROM poll_votes → only their own
--      rows. Non-anonymous: managers see all rows.
--   5. results_visibility='after_close': resident poll_results while open →
--      votes NULL, hidden=true, turnout visible; manager → full numbers.
--   6. close_poll → 'poll_closed' notifications; results open up.
--   7. node scripts/rls-audit.mjs — polls/poll_votes invisible off-scope.
-- ============================================================
