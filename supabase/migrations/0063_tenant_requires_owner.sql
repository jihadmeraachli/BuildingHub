-- ============================================================
-- 0063_tenant_requires_owner.sql
-- A tenant can't exist without an owner (extends T4 / 0062).
--
-- Supersedes the 0062 trigger function (CREATE OR REPLACE + recreate trigger),
-- so running this alone establishes the full rule set whether or not 0062 ran:
--   (a) at most one active owner and one active tenant per unit
--   (b) a tenant may only be added to a unit that already has an active owner
--   (c) the owner can't be removed (soft-ended or deleted) while an active
--       tenant remains — that would strand the tenant
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION memberships_one_per_tenure()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.ended_at IS NULL THEN
    -- (a) one active member per tenure
    IF EXISTS (SELECT 1 FROM memberships m
                WHERE m.unit_id = NEW.unit_id AND m.tenure = NEW.tenure
                  AND m.ended_at IS NULL AND m.id <> NEW.id) THEN
      RAISE EXCEPTION 'This unit already has an active %. Remove the existing one first.', NEW.tenure
        USING ERRCODE = '23505';
    END IF;

    -- (b) a tenant needs an active owner on the same unit
    IF NEW.tenure = 'tenant' AND NOT EXISTS (
      SELECT 1 FROM memberships m
       WHERE m.unit_id = NEW.unit_id AND m.tenure = 'owner'
         AND m.ended_at IS NULL AND m.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'Add an owner to this unit before assigning a tenant.'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  -- (c) removing the owner (soft-end or hard delete) while a tenant is active
  IF (TG_OP = 'UPDATE' AND OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL AND OLD.tenure = 'owner')
     OR (TG_OP = 'DELETE' AND OLD.ended_at IS NULL AND OLD.tenure = 'owner') THEN
    IF EXISTS (SELECT 1 FROM memberships m
                WHERE m.unit_id = OLD.unit_id AND m.tenure = 'tenant'
                  AND m.ended_at IS NULL AND m.id <> OLD.id) THEN
      RAISE EXCEPTION 'Remove the tenant before removing the owner of this unit.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS memberships_one_per_tenure_trg ON memberships;
CREATE TRIGGER memberships_one_per_tenure_trg
  BEFORE INSERT OR UPDATE OR DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION memberships_one_per_tenure();

COMMIT;
