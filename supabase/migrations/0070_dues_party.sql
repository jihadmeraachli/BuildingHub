-- ============================================================
-- 0070_dues_party.sql
-- Dues become party-aware (#61 / testing feedback C12-C13).
--
-- Until now a dues row was unit-level: one obligation, implicitly the owner's,
-- trued up against the unit's TOTAL balance. With the owner/tenant sub-ledger
-- (0064-0067) that is wrong for leased units — the tenant's carry-in would be
-- netted against the owner's dues and vice versa.
--
-- WHAT CHANGES
--   1. dues_plans.owner_pool_amount — an owner-only slice of each period,
--      allocated by the plan's existing method. The existing pool_amount is now
--      explicitly "the recurring budget, billed to the TENANT where a unit is
--      leased, to the owner otherwise". Default 0 = no owner slice, which is
--      exactly today's behaviour.
--   2. dues rows carry billed_to / tenant_id / kind / label, mirroring
--      charges.billed_to (0018) + charges.tenant_id (0066).
--   3. The three dues notification triggers become party-aware. They currently
--      fan to EVERY membership on the unit with no ended_at filter, so a tenant
--      who moved out in 2025 still gets this quarter's dues notice. Same bug
--      0067 fixed for charges/payments; dues were missed because the party
--      split did not exist yet.
--   4. reminders_sent gains `party`, and its uniqueness widens from
--      (unit, period) to (unit, period, party). Without this the owner and the
--      tenant of the same unit collide on the dedup index and the second
--      reminder is dropped as a duplicate — silently, since send-reminders
--      treats 23505 as "already sent".
--   5. get_overdue_dues() is rebuilt per unit PER PARTY: party-scoped
--      recipients, party-scoped payment offset, and it now SUMS a party's rows
--      within the latest overdue period so an off-budget assessment sitting
--      next to a recurring due is not ignored.
--
-- BACKFILL: every existing dues row becomes billed_to='owner',
-- kind='recurring', tenant_id=NULL. Legacy dues were unit-level, and a
-- unit-level obligation is the owner's, so nothing already generated changes
-- meaning. Existing plans keep generating identically until someone sets an
-- owner pool.
--
-- ⚠️ OPS ORDER: run this migration AND redeploy `send-reminders` +
-- `dynamic-action` together. Between the two, dues reminders for tenants are
-- skipped as duplicates (owner reminders keep working — get_overdue_dues still
-- returns owner_user_ids under its old name precisely so the un-redeployed
-- function degrades gracefully instead of going silent).
--
-- Additive & idempotent. The only DROP is the reminders_sent uniqueness index,
-- which is RELAXED (widened), never data-destructive.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Plan: the owner-only pool
-- ------------------------------------------------------------
ALTER TABLE dues_plans
  ADD COLUMN IF NOT EXISTS owner_pool_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN dues_plans.pool_amount IS
  'Recurring budget per period. Billed to the TENANT on leased units, to the owner otherwise.';
COMMENT ON COLUMN dues_plans.owner_pool_amount IS
  'Owner-only slice per period, allocated by the same method. 0 = none.';

-- method='custom' allocates per unit from dues_unit_amounts; the owner slice
-- needs its own per-unit column or a custom plan could not express one.
ALTER TABLE dues_unit_amounts
  ADD COLUMN IF NOT EXISTS owner_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN dues_unit_amounts.amount       IS 'Per-unit recurring base (tenant where leased, owner otherwise).';
COMMENT ON COLUMN dues_unit_amounts.owner_amount IS 'Per-unit owner-only slice. 0 = none.';

-- ------------------------------------------------------------
-- 2. Dues rows: party attribution
-- ------------------------------------------------------------
ALTER TABLE dues ADD COLUMN IF NOT EXISTS billed_to TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE dues ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE dues ADD COLUMN IF NOT EXISTS kind      TEXT NOT NULL DEFAULT 'recurring';
ALTER TABLE dues ADD COLUMN IF NOT EXISTS label     TEXT;

COMMENT ON COLUMN dues.billed_to IS 'owner | tenant — which sub-ledger this obligation falls on.';
COMMENT ON COLUMN dues.tenant_id IS 'The specific tenant billed (profiles.id); NULL on owner rows. Never rewritten on move-out — it is the audit trail of who was tenant when the due was issued.';
COMMENT ON COLUMN dues.kind      IS 'recurring (from the plan pool) | off_budget (one-time special assessment).';
COMMENT ON COLUMN dues.label     IS 'Name of an off_budget assessment, e.g. "Roof waterproofing 2026".';

-- Existing rows are unit-level == owner. Explicit, not just the column default,
-- so re-running after a partial apply still lands them correctly.
UPDATE dues SET billed_to = 'owner'     WHERE billed_to IS NULL;
UPDATE dues SET kind      = 'recurring' WHERE kind      IS NULL;

ALTER TABLE dues DROP CONSTRAINT IF EXISTS dues_billed_to_chk;
ALTER TABLE dues ADD  CONSTRAINT dues_billed_to_chk CHECK (billed_to IN ('owner','tenant'));

ALTER TABLE dues DROP CONSTRAINT IF EXISTS dues_kind_chk;
ALTER TABLE dues ADD  CONSTRAINT dues_kind_chk CHECK (kind IN ('recurring','off_budget'));

-- A tenant_id only makes sense on a tenant row.
ALTER TABLE dues DROP CONSTRAINT IF EXISTS dues_tenant_id_chk;
ALTER TABLE dues ADD  CONSTRAINT dues_tenant_id_chk
  CHECK (billed_to = 'tenant' OR tenant_id IS NULL);

CREATE INDEX IF NOT EXISTS dues_tenant_idx ON dues(tenant_id) WHERE tenant_id IS NOT NULL;
-- Drives the "carry-in is consumed once per unit + period + party" lookup at
-- generation time, and the grouped sub-row rendering in the Dues tab.
CREATE INDEX IF NOT EXISTS dues_unit_period_party_idx ON dues(unit_id, period_label, billed_to);

-- ------------------------------------------------------------
-- 3. Notifications follow the billed party (the 0067 pattern, for dues)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_on_dues() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT m.user_id, NEW.building_id, 'dues_issued',
         'Dues due',
         'Your dues for ' || NEW.period_label || ' are $' || NEW.amount_due ||
         COALESCE(' — due ' || NEW.due_date::text, '')
  FROM memberships m
  WHERE m.unit_id = NEW.unit_id AND m.ended_at IS NULL
    AND (
      (NEW.billed_to = 'tenant' AND m.tenure = 'tenant'
         AND (NEW.tenant_id IS NULL OR m.user_id = NEW.tenant_id))
      OR (NEW.billed_to <> 'tenant' AND m.tenure = 'owner')
    );
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_dues ON dues;
CREATE TRIGGER trg_notify_dues AFTER INSERT ON dues
  FOR EACH ROW EXECUTE FUNCTION notify_on_dues();

CREATE OR REPLACE FUNCTION notify_on_dues_update() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.amount_due IS DISTINCT FROM OLD.amount_due THEN
    INSERT INTO notifications (user_id, building_id, type, title, body)
    SELECT m.user_id, NEW.building_id, 'dues_updated',
           'Dues updated',
           'Your dues for ' || NEW.period_label || ' were updated to $' || NEW.amount_due
    FROM memberships m
    WHERE m.unit_id = NEW.unit_id AND m.ended_at IS NULL
      AND (
        (NEW.billed_to = 'tenant' AND m.tenure = 'tenant'
           AND (NEW.tenant_id IS NULL OR m.user_id = NEW.tenant_id))
        OR (NEW.billed_to <> 'tenant' AND m.tenure = 'owner')
      );
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_dues_update ON dues;
CREATE TRIGGER trg_notify_dues_update AFTER UPDATE ON dues
  FOR EACH ROW EXECUTE FUNCTION notify_on_dues_update();

CREATE OR REPLACE FUNCTION notify_on_dues_delete() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT m.user_id, OLD.building_id, 'dues_removed',
         'Dues removed', 'Your dues for ' || OLD.period_label || ' were removed'
  FROM memberships m
  WHERE m.unit_id = OLD.unit_id AND m.ended_at IS NULL
    AND (
      (OLD.billed_to = 'tenant' AND m.tenure = 'tenant'
         AND (OLD.tenant_id IS NULL OR m.user_id = OLD.tenant_id))
      OR (OLD.billed_to <> 'tenant' AND m.tenure = 'owner')
    );
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_dues_delete ON dues;
CREATE TRIGGER trg_notify_dues_delete AFTER DELETE ON dues
  FOR EACH ROW EXECUTE FUNCTION notify_on_dues_delete();

-- ------------------------------------------------------------
-- 4. Reminder dedup becomes per party
--    (unit, period) -> (unit, period, party). Widening only: every existing
--    row is an owner reminder, and every pair that was unique before stays
--    unique now.
-- ------------------------------------------------------------
ALTER TABLE reminders_sent ADD COLUMN IF NOT EXISTS party TEXT NOT NULL DEFAULT 'owner';

ALTER TABLE reminders_sent DROP CONSTRAINT IF EXISTS reminders_sent_party_chk;
ALTER TABLE reminders_sent ADD  CONSTRAINT reminders_sent_party_chk CHECK (party IN ('owner','tenant'));

DROP INDEX IF EXISTS reminders_sent_once_idx;
CREATE UNIQUE INDEX IF NOT EXISTS reminders_sent_once_idx
  ON reminders_sent(unit_id, period, party);

-- ------------------------------------------------------------
-- 5. get_overdue_dues(): per unit, PER PARTY
--
--    Three fixes over the 0056 version:
--      a. one row per (unit, party) instead of one per unit;
--      b. the payment offset only counts payments made BY that party, so a
--         tenant's payment can no longer cancel the owner's overdue reminder;
--      c. it SUMS the party's dues within the latest overdue period, so an
--         off_budget assessment alongside a recurring due is included instead
--         of being hidden by DISTINCT ON.
--
--    `owner_user_ids` keeps its name (it is the recipient list) so that an
--    un-redeployed send-reminders keeps working for owners rather than going
--    silent. New columns are additive.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_overdue_dues();
CREATE FUNCTION get_overdue_dues()
RETURNS TABLE (
  unit_id        UUID,
  unit_label     TEXT,
  building_id    UUID,
  building_name  TEXT,
  period_label   TEXT,
  due_date       DATE,
  amount_due     NUMERIC,
  party          TEXT,
  tenant_id      UUID,
  tenant_name    TEXT,
  owner_user_ids UUID[]
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH today AS (
    SELECT EXTRACT(DAY FROM (now() AT TIME ZONE 'Asia/Beirut'))::INT AS d,
           to_char(now() AT TIME ZONE 'Asia/Beirut', 'YYYY-MM')      AS period
  ),
  overdue AS (
    SELECT d.*
    FROM dues d
    WHERE d.due_date IS NOT NULL AND d.due_date < CURRENT_DATE AND d.amount_due > 0
  ),
  -- latest overdue period per (unit, party); tenant_id NULL-safe
  latest AS (
    SELECT DISTINCT ON (o.unit_id, o.billed_to, o.tenant_id)
           o.unit_id, o.building_id, o.billed_to, o.tenant_id,
           o.period_label, o.due_date, o.created_at
    FROM overdue o
    ORDER BY o.unit_id, o.billed_to, o.tenant_id, o.due_date DESC, o.created_at DESC
  ),
  agg AS (
    SELECT l.*,
           -- recurring + off_budget for that party in that period
           (SELECT COALESCE(SUM(o2.amount_due), 0)
              FROM overdue o2
             WHERE o2.unit_id      = l.unit_id
               AND o2.billed_to    = l.billed_to
               AND o2.tenant_id IS NOT DISTINCT FROM l.tenant_id
               AND o2.period_label = l.period_label) AS billed,
           -- only THAT party's payments count against it
           (SELECT COALESCE(SUM(p.amount_usd), 0)
              FROM payments p
             WHERE p.unit_id = l.unit_id
               AND p.voided_at IS NULL
               AND p.created_at >= l.created_at
               AND (
                 (l.billed_to = 'tenant' AND p.paid_by = 'tenant'
                    AND (l.tenant_id IS NULL OR p.tenant_id = l.tenant_id))
                 OR (l.billed_to <> 'tenant' AND p.paid_by IS DISTINCT FROM 'tenant')
               )) AS settled
      FROM latest l
  )
  SELECT
    a.unit_id, u.label, b.id, b.name, a.period_label, a.due_date,
    GREATEST(0, ROUND(a.billed - a.settled, 2)) AS amount_due,
    a.billed_to AS party,
    a.tenant_id,
    (SELECT pr.full_name FROM profiles pr WHERE pr.id = a.tenant_id) AS tenant_name,
    COALESCE((
      SELECT ARRAY_AGG(DISTINCT m.user_id)
        FROM memberships m
       WHERE m.unit_id = a.unit_id AND m.ended_at IS NULL
         AND (
           (a.billed_to =  'tenant' AND m.tenure = 'tenant'
              AND (a.tenant_id IS NULL OR m.user_id = a.tenant_id))
           OR (a.billed_to <> 'tenant' AND m.tenure = 'owner')
         )
    ), ARRAY[]::UUID[])
  FROM agg a
  JOIN units     u ON u.id = a.unit_id
  JOIN buildings b ON b.id = a.building_id AND b.is_active = true
  CROSS JOIN today t
  WHERE b.reminder_day = t.d
    AND effective_billing_mode(b.id) = 'dues'
    AND GREATEST(0, ROUND(a.billed - a.settled, 2)) > 0
    AND NOT EXISTS (
      SELECT 1 FROM reminders_sent rs
      WHERE rs.unit_id = a.unit_id
        AND rs.period  = t.period
        AND rs.party   = a.billed_to
    );
$$;

-- Cron helper stays service-only (0043 discipline).
REVOKE ALL     ON FUNCTION get_overdue_dues() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_overdue_dues() TO service_role;

COMMIT;
