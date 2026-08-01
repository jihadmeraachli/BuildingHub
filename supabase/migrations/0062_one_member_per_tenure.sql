-- ============================================================
-- 0062_one_member_per_tenure.sql
-- A unit may have at most one active owner and one active tenant (T4).
--
-- The owner/tenant money split (charges/payments/balances per party) assumes a
-- single owner and a single tenant per unit. Until now a unit could be given a
-- second owner (or tenant), corrupting who is responsible.
--
-- Enforced with a BEFORE trigger rather than a partial unique index, because
-- existing data may already contain duplicates from the old behaviour — a unique
-- index would fail to build. The trigger blocks NEW duplicates; any existing
-- ones are cleaned up in the UI (remove the extra member).
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION memberships_one_per_tenure()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- only guard ACTIVE memberships (ended_at IS NULL); a past tenant doesn't block a new one
  IF NEW.ended_at IS NULL AND EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.unit_id = NEW.unit_id
      AND m.tenure  = NEW.tenure
      AND m.ended_at IS NULL
      AND m.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'This unit already has an active %. Remove the existing one first.', NEW.tenure
      USING ERRCODE = '23505';   -- unique_violation, so the client can detect it
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS memberships_one_per_tenure_trg ON memberships;
CREATE TRIGGER memberships_one_per_tenure_trg
  BEFORE INSERT OR UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION memberships_one_per_tenure();

COMMIT;

-- ------------------------------------------------------------
-- Find existing duplicates to clean up (read-only):
--   SELECT unit_id, tenure, count(*)
--   FROM memberships WHERE ended_at IS NULL
--   GROUP BY unit_id, tenure HAVING count(*) > 1;
-- ------------------------------------------------------------
