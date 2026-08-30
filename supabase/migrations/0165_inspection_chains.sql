-- ============================================================
-- 0165_inspection_chains.sql
-- Inspections redesign (Jey, 30 Aug): user-defined categories + a
-- self-perpetuating chain.
--
-- THE CHAIN. Recording an inspection with a "next due" date AUTO-CREATES
-- the next inspection as a real row with status 'due' on that date. When
-- the day comes, the admin opens that row, records the result (passed /
-- failed / ...), and if they set another next date the chain continues.
-- Completion is no longer "remember to move a date" - the due record IS
-- the reminder, the work item, and (once filled) the history.
--
-- Mechanics:
--   * inspections.spawned_from links a 'due' row to the inspection that
--     scheduled it - the chain's backbone, and the dedup key.
--   * An AFTER trigger on inspections maintains the successor:
--       - completed row gains/changes next_due_date -> upsert its 'due'
--         successor (move the date, never duplicate);
--       - next_due_date cleared -> a successor still 'due' is removed;
--       - successors themselves (status 'due') never spawn, no recursion.
--   * get_due_inspections() now reads 'due' rows (inspection_date is the
--     deadline) - same signature/columns, so send-reminders needs NO
--     redeploy; the Monday email works unchanged.
--   * Backfill: every existing row with a next_due_date gets its 'due'
--     successor created once, by firing the trigger with a no-op UPDATE.
--
-- CATEGORIES. inspection_categories: per building/compound, user-created
-- ("Pest control", "Generator", ...). inspections.category_id points at
-- them; the legacy enum column stays for old rows (new rows store 'other'
-- there to satisfy the old CHECK). RLS mirrors inspections (0014).
--
-- Additive & idempotent.
-- ============================================================
BEGIN;
SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------------------
-- 1. Categories.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inspection_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id UUID REFERENCES buildings(id) ON DELETE CASCADE,
  compound_id UUID REFERENCES compounds(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inspection_categories_scope CHECK ((building_id IS NOT NULL) <> (compound_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS inspection_categories_b_uidx
  ON inspection_categories(building_id, lower(name)) WHERE building_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inspection_categories_c_uidx
  ON inspection_categories(compound_id, lower(name)) WHERE compound_id IS NOT NULL;

ALTER TABLE inspection_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inspection_categories_select ON inspection_categories;
CREATE POLICY inspection_categories_select ON inspection_categories FOR SELECT USING (
  (building_id IS NOT NULL AND (user_can(building_id,'finance.view') OR user_can(building_id,'building.manage') OR user_member_building(building_id)))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = inspection_categories.compound_id
          AND (user_can(b.id,'building.manage') OR user_can(b.id,'finance.view') OR user_member_building(b.id))))
);
DROP POLICY IF EXISTS inspection_categories_write ON inspection_categories;
CREATE POLICY inspection_categories_write ON inspection_categories FOR ALL USING (
  (building_id IS NOT NULL AND user_can(building_id,'building.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = inspection_categories.compound_id AND user_can(b.id,'building.manage')))
) WITH CHECK (
  (building_id IS NOT NULL AND user_can(building_id,'building.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = inspection_categories.compound_id AND user_can(b.id,'building.manage')))
);

-- ------------------------------------------------------------
-- 2. Inspections: chain columns + the 'due' status.
-- ------------------------------------------------------------
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS category_id  UUID REFERENCES inspection_categories(id) ON DELETE SET NULL;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS spawned_from UUID REFERENCES inspections(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS inspections_spawned_idx ON inspections(spawned_from) WHERE spawned_from IS NOT NULL;
CREATE INDEX IF NOT EXISTS inspections_due_idx ON inspections(status, inspection_date) WHERE status = 'due';

ALTER TABLE inspections DROP CONSTRAINT IF EXISTS inspections_status_check;
ALTER TABLE inspections ADD CONSTRAINT inspections_status_check
  CHECK (status IN ('passed','failed','action_required','pending','due'));

-- ------------------------------------------------------------
-- 3. The chain trigger.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION inspections_chain() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_succ inspections;
BEGIN
  -- 'due' rows are successors; they only spawn once COMPLETED (status change)
  IF NEW.status = 'due' THEN RETURN NEW; END IF;

  SELECT * INTO v_succ FROM inspections s WHERE s.spawned_from = NEW.id LIMIT 1;

  IF NEW.next_due_date IS NOT NULL THEN
    IF v_succ.id IS NOT NULL THEN
      -- move/refresh the pending successor; a successor already completed
      -- is history and stays untouched
      IF v_succ.status = 'due' THEN
        UPDATE inspections SET
          inspection_date = NEW.next_due_date,
          category        = NEW.category,
          category_id     = NEW.category_id,
          title           = NEW.title,
          amenity_id      = NEW.amenity_id,
          contact_id      = NEW.contact_id,
          inspector       = NEW.inspector,
          building_id     = NEW.building_id,
          compound_id     = NEW.compound_id
        WHERE id = v_succ.id;
      END IF;
    ELSE
      INSERT INTO inspections
        (building_id, compound_id, category, category_id, title, inspector, contact_id,
         amenity_id, inspection_date, status, next_due_date, spawned_from, created_by)
      VALUES
        (NEW.building_id, NEW.compound_id, NEW.category, NEW.category_id, NEW.title, NEW.inspector, NEW.contact_id,
         NEW.amenity_id, NEW.next_due_date, 'due', NULL, NEW.id, NEW.created_by);
    END IF;
  ELSE
    -- schedule cleared: remove a successor that is still just a placeholder
    IF v_succ.id IS NOT NULL AND v_succ.status = 'due' THEN
      DELETE FROM inspections WHERE id = v_succ.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS inspections_chain_trg ON inspections;
CREATE TRIGGER inspections_chain_trg AFTER INSERT OR UPDATE ON inspections
  FOR EACH ROW EXECUTE FUNCTION inspections_chain();

-- Backfill: existing scheduled rows get their 'due' successor (no-op UPDATE
-- fires the trigger; rows that already have one are upserted, not duplicated).
UPDATE inspections SET next_due_date = next_due_date
WHERE next_due_date IS NOT NULL AND status <> 'due';

-- ------------------------------------------------------------
-- 4. Reminders now read the 'due' rows. Same signature and columns as
--    0023, so send-reminders keeps working without a redeploy - the
--    successor's inspection_date IS the deadline.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_due_inspections(days_ahead INT DEFAULT 7)
RETURNS TABLE (
  inspection_id   UUID,
  title           TEXT,
  category        TEXT,
  next_due_date   DATE,
  building_id     UUID,
  compound_id     UUID,
  location_name   TEXT,
  admin_user_ids  UUID[]
) LANGUAGE SQL SECURITY DEFINER AS $$
  SELECT
    i.id,
    i.title,
    COALESCE(ic.name, i.category) AS category,
    i.inspection_date AS next_due_date,
    i.building_id,
    i.compound_id,
    COALESCE(b.name, c.name) AS location_name,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT g.user_id), NULL) AS admin_user_ids
  FROM inspections i
  LEFT JOIN inspection_categories ic ON ic.id = i.category_id
  LEFT JOIN buildings b  ON b.id = i.building_id
  LEFT JOIN compounds c  ON c.id = i.compound_id
  LEFT JOIN grants g ON (
    (i.building_id IS NOT NULL AND g.building_id = i.building_id AND g.scope_type = 'building' AND g.role = 'building_admin')
    OR
    (i.building_id IS NOT NULL AND g.scope_type = 'org' AND g.role = 'org_admin'
      AND EXISTS (
        SELECT 1 FROM org_buildings ob
        WHERE ob.org_id = g.org_id AND ob.building_id = i.building_id
      ))
    OR
    (i.compound_id IS NOT NULL AND g.scope_type = 'org' AND g.role = 'org_admin'
      AND EXISTS (
        SELECT 1 FROM org_buildings ob
        JOIN buildings bx ON bx.id = ob.building_id
        WHERE ob.org_id = g.org_id AND bx.compound_id = i.compound_id
      ))
  )
  WHERE i.status = 'due'
    AND i.inspection_date <= CURRENT_DATE + days_ahead
  GROUP BY i.id, i.title, COALESCE(ic.name, i.category), i.inspection_date,
           i.building_id, i.compound_id, COALESCE(b.name, c.name)
$$;

COMMIT;

-- Post-run checks:
--   1. Record an inspection with next due = tomorrow -> a second row appears,
--      status 'due', dated tomorrow, spawned_from set.
--   2. Change the next-due date -> the SAME due row moves (no duplicate).
--   3. Clear the next-due date -> the due row disappears.
--   4. SELECT * FROM get_due_inspections(7) -> lists the due row with the
--      category NAME (user category, else legacy enum).
