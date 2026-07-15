-- ============================================================
-- BuildingHub — SQL helper functions for the send-reminders edge function
-- SECURITY DEFINER so the edge function can call these via RPC
-- with the service role key, bypassing RLS.
-- Safe to re-run (CREATE OR REPLACE).
-- ============================================================

-- ── 1. Units with outstanding balance ───────────────────────────────────────
-- Returns every active unit whose balance (charges − payments) is positive.
-- Includes the unit owner user_ids from memberships (may be empty if not set up).
CREATE OR REPLACE FUNCTION get_overdue_units()
RETURNS TABLE (
  unit_id        UUID,
  unit_label     TEXT,
  building_id    UUID,
  building_name  TEXT,
  balance_usd    NUMERIC,
  owner_user_ids UUID[]
) LANGUAGE SQL SECURITY DEFINER AS $$
  SELECT
    u.id,
    u.label,
    b.id,
    b.name,
    ROUND(
      COALESCE(SUM(ch.amount_usd), 0) - COALESCE(SUM(py.amount_usd), 0),
      2
    ) AS balance_usd,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT m.user_id), NULL) AS owner_user_ids
  FROM units u
  JOIN buildings b ON b.id = u.building_id AND b.is_active = true
  LEFT JOIN charges  ch ON ch.unit_id = u.id
  LEFT JOIN payments py ON py.unit_id = u.id
  LEFT JOIN memberships m ON m.unit_id = u.id AND m.tenure = 'owner'
  GROUP BY u.id, u.label, b.id, b.name
  HAVING ROUND(
    COALESCE(SUM(ch.amount_usd), 0) - COALESCE(SUM(py.amount_usd), 0),
    2
  ) > 0
$$;

-- ── 2. Dues items that are overdue (past due_date, amount > 0) ──────────────
-- Groups by unit so each unit gets one row with the latest overdue period.
CREATE OR REPLACE FUNCTION get_overdue_dues()
RETURNS TABLE (
  unit_id        UUID,
  unit_label     TEXT,
  building_id    UUID,
  building_name  TEXT,
  period_label   TEXT,
  due_date       DATE,
  amount_due     NUMERIC,
  owner_user_ids UUID[]
) LANGUAGE SQL SECURITY DEFINER AS $$
  SELECT DISTINCT ON (d.unit_id)
    d.unit_id,
    u.label,
    b.id,
    b.name,
    d.period_label,
    d.due_date,
    d.amount_due,
    COALESCE(owners.user_ids, ARRAY[]::UUID[]) AS owner_user_ids
  FROM dues d
  JOIN units u ON u.id = d.unit_id
  JOIN buildings b ON b.id = d.building_id AND b.is_active = true
  LEFT JOIN (
    SELECT unit_id, ARRAY_AGG(DISTINCT user_id) AS user_ids
    FROM memberships
    WHERE tenure = 'owner'
    GROUP BY unit_id
  ) owners ON owners.unit_id = d.unit_id
  WHERE d.due_date IS NOT NULL
    AND d.due_date < CURRENT_DATE
    AND d.amount_due > 0
  ORDER BY d.unit_id, d.due_date DESC
$$;

-- ── 3. Inspections due within N days or already overdue ─────────────────────
-- Returns building-level and compound-level inspections approaching next_due_date.
-- Also returns building admin user_ids (building_admin grants).
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
    i.category,
    i.next_due_date,
    i.building_id,
    i.compound_id,
    COALESCE(b.name, c.name) AS location_name,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT g.user_id), NULL) AS admin_user_ids
  FROM inspections i
  LEFT JOIN buildings b  ON b.id = i.building_id
  LEFT JOIN compounds c  ON c.id = i.compound_id
  -- building admins: direct grant on the building
  LEFT JOIN grants g ON (
    (i.building_id IS NOT NULL AND g.building_id = i.building_id AND g.scope_type = 'building' AND g.role = 'building_admin')
    OR
    -- org admins whose org owns the building
    (i.building_id IS NOT NULL AND g.scope_type = 'org' AND g.role = 'org_admin'
      AND EXISTS (
        SELECT 1 FROM org_buildings ob
        WHERE ob.org_id = g.org_id AND ob.building_id = i.building_id
      ))
    OR
    -- compound-level: org admins whose org has any building in the compound
    (i.compound_id IS NOT NULL AND g.scope_type = 'org' AND g.role = 'org_admin'
      AND EXISTS (
        SELECT 1 FROM org_buildings ob
        JOIN buildings bx ON bx.id = ob.building_id
        WHERE ob.org_id = g.org_id AND bx.compound_id = i.compound_id
      ))
  )
  WHERE i.next_due_date IS NOT NULL
    AND i.next_due_date <= CURRENT_DATE + days_ahead
  GROUP BY i.id, i.title, i.category, i.next_due_date, i.building_id, i.compound_id,
           COALESCE(b.name, c.name)
$$;
