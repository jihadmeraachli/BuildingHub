-- ============================================================
-- 0080_request_any_mode.sql
-- A dues building can issue a one-off payment request too.
--
-- 0076 gated arrears requests on effective_billing_mode = 'arrears'. That was
-- right for the AUTOMATIC ask - a b1 dues plan already nets the balance into
-- amount_due through the carry-in true-up, so a routine "settle your balance"
-- on top would demand the same money twice - but wrong for a DELIBERATE one:
-- a dues building still has large one-off expenses to settle, and the admin
-- pressing "Request payment" is an explicit act, not a schedule.
--
-- So the filter moves from the billing mode to the obligation: a payment
-- request is chased because it EXISTS, whatever mode the building is in. Dues
-- reminders still only run in dues mode.
--
-- ⚠️ THE COLLISION THIS CREATES. reminders_sent was unique per
-- (unit, sent_on, party), and send-reminders treats a duplicate-key error as
-- "already sent". A dues building with an open request would hit both loops on
-- the same day: the arrears loop inserts first, the dues loop collides and its
-- reminder is silently dropped. The resident would hear about the one-off and
-- never about their dues - the 0070/0076 silent-failure class again.
--
-- The key therefore gains `source`. A request and a dues item are different
-- obligations with different due dates, so both may legitimately go out on the
-- same day; deduplication should only stop the SAME obligation being sent
-- twice.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE reminders_sent ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'arrears';
ALTER TABLE reminders_sent DROP CONSTRAINT IF EXISTS reminders_sent_source_chk;
ALTER TABLE reminders_sent ADD  CONSTRAINT reminders_sent_source_chk
  CHECK (source IN ('arrears','dues'));

COMMENT ON COLUMN reminders_sent.source IS
  'Which obligation this reminder was for. Part of the dedup key: a building can owe on a one-off request AND on dues in the same day, and one must not silence the other.';

DROP INDEX IF EXISTS reminders_sent_once_idx;
CREATE UNIQUE INDEX IF NOT EXISTS reminders_sent_once_idx
  ON reminders_sent(unit_id, sent_on, party, source);

-- ------------------------------------------------------------
-- Requests are chased because they exist, not because of the billing mode.
-- Body is 0076's, minus the mode filter, plus the source-aware dedup.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_overdue_units();
CREATE FUNCTION get_overdue_units()
RETURNS TABLE (
  unit_id        UUID,
  unit_label     TEXT,
  building_id    UUID,
  building_name  TEXT,
  balance_usd    NUMERIC,
  request_label  TEXT,
  due_date       DATE,
  is_overdue     BOOLEAN,
  party          TEXT,
  owner_user_ids UUID[]
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Beirut')::date AS d),
  live AS (
    SELECT l.id, l.unit_id, l.building_id, l.tenant_id, r.label, r.due_date, t.d,
           effective_obligation_party(l.unit_id, l.party, l.tenant_id) AS eff_party,
           request_line_outstanding(l.id) AS owed
    FROM payment_request_lines l
    JOIN payment_requests r ON r.id = l.request_id
    JOIN buildings b        ON b.id = l.building_id AND b.is_active = true
    CROSS JOIN today t
    WHERE l.cancelled_at IS NULL
      AND reminder_is_send_day(t.d, r.requested_on, r.due_date)
  )
  SELECT
    v.unit_id, u.label, b.id, b.name, v.owed, v.label, v.due_date,
    (v.d > v.due_date) AS is_overdue, v.eff_party,
    COALESCE((
      SELECT ARRAY_AGG(DISTINCT m.user_id) FROM memberships m
      WHERE m.unit_id = v.unit_id AND m.ended_at IS NULL
        AND ((v.eff_party = 'tenant' AND m.tenure = 'tenant'
                AND (v.tenant_id IS NULL OR m.user_id = v.tenant_id))
          OR (v.eff_party = 'owner'  AND m.tenure = 'owner'))
    ), ARRAY[]::UUID[])
  FROM live v
  JOIN units u     ON u.id = v.unit_id
  JOIN buildings b ON b.id = v.building_id
  WHERE v.owed > 0
    AND NOT EXISTS (
      SELECT 1 FROM reminders_sent rs
      WHERE rs.unit_id = v.unit_id AND rs.sent_on = v.d
        AND rs.party = v.eff_party AND rs.source = 'arrears'
    );
$$;

-- Dues: unchanged except the dedup now names its own source, so an open
-- one-off request in the same building can no longer silence it.
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
  is_overdue     BOOLEAN,
  owner_user_ids UUID[]
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Beirut')::date AS d),
  live AS (
    SELECT d.*, t.d AS today,
           effective_obligation_party(d.unit_id, d.billed_to, d.tenant_id) AS eff_party
    FROM dues d
    CROSS JOIN today t
    JOIN buildings b ON b.id = d.building_id AND b.is_active = true
    WHERE d.due_date IS NOT NULL
      AND effective_billing_mode(d.building_id) = 'dues'
      AND d.amount_due > 0
      AND reminder_is_send_day(t.d, d.created_at::date, d.due_date)
  ),
  latest AS (
    SELECT DISTINCT ON (l.unit_id, l.eff_party, l.tenant_id)
           l.unit_id, l.building_id, l.billed_to, l.eff_party, l.tenant_id,
           l.period_label, l.due_date, l.created_at, l.today
    FROM live l
    ORDER BY l.unit_id, l.eff_party, l.tenant_id, l.due_date DESC, l.created_at DESC
  ),
  agg AS (
    SELECT a.*,
      (SELECT COALESCE(SUM(o.amount_due), 0) FROM live o
        WHERE o.unit_id = a.unit_id AND o.eff_party = a.eff_party
          AND o.tenant_id IS NOT DISTINCT FROM a.tenant_id
          AND o.period_label = a.period_label) AS billed,
      (SELECT COALESCE(SUM(p.amount_usd), 0) FROM payments p
        WHERE p.unit_id = a.unit_id AND p.voided_at IS NULL
          AND p.created_at >= a.created_at
          AND CASE WHEN a.eff_party = 'tenant'
                   THEN p.paid_by = 'tenant' AND (a.tenant_id IS NULL OR p.tenant_id = a.tenant_id)
                   ELSE p.paid_by IS DISTINCT FROM 'tenant' END) AS settled
    FROM latest a
  )
  SELECT
    a.unit_id, u.label, b.id, b.name, a.period_label, a.due_date,
    GREATEST(0, ROUND(a.billed - a.settled, 2)),
    a.eff_party, a.tenant_id,
    (SELECT pr.full_name FROM profiles pr WHERE pr.id = a.tenant_id),
    (a.today > a.due_date) AS is_overdue,
    COALESCE((
      SELECT ARRAY_AGG(DISTINCT m.user_id) FROM memberships m
      WHERE m.unit_id = a.unit_id AND m.ended_at IS NULL
        AND ((a.eff_party = 'tenant' AND m.tenure = 'tenant'
                AND (a.tenant_id IS NULL OR m.user_id = a.tenant_id))
          OR (a.eff_party = 'owner'  AND m.tenure = 'owner'))
    ), ARRAY[]::UUID[])
  FROM agg a
  JOIN units u     ON u.id = a.unit_id
  JOIN buildings b ON b.id = a.building_id
  WHERE GREATEST(0, ROUND(a.billed - a.settled, 2)) > 0
    AND NOT EXISTS (
      SELECT 1 FROM reminders_sent rs
      WHERE rs.unit_id = a.unit_id AND rs.sent_on = a.today
        AND rs.party = a.eff_party AND rs.source = 'dues'
    );
$$;

REVOKE ALL     ON FUNCTION get_overdue_units() FROM PUBLIC, anon, authenticated;
REVOKE ALL     ON FUNCTION get_overdue_dues()  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_overdue_units() TO service_role;
GRANT  EXECUTE ON FUNCTION get_overdue_dues()  TO service_role;

COMMIT;

-- ⚠️ send-reminders MUST be redeployed with this: it now has to write
-- `source` on the reminders_sent insert. Until then both loops write the
-- default 'arrears' and the dues loop collides exactly as before.

-- ============================================================
-- Post-run checks:
--   1. On a DUES building, issue a payment request -> it appears in
--      get_overdue_units() (it did not before this migration).
--   2. With both an open request and unpaid dues on one unit, both rows come
--      back and both send: two reminders_sent rows, same day, different source.
-- ============================================================
