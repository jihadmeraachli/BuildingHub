-- ============================================================
-- 0082_chase_all_dues.sql
-- Chase EVERY unpaid dues period, not just the latest one.
--
-- get_overdue_dues kept one row per (unit, party, tenant) — DISTINCT ON ordered
-- by due_date DESC — so an unpaid period went silent as soon as a later-dated
-- dues row existed. Q3 of 500 unpaid, then a 200 fuel ask due later: the
-- reminder chased 200 and the 500 was never mentioned again.
--
-- That was CORRECT until this morning. Under the b1 true-up the next period's
-- carry absorbed the unpaid one, so the latest row genuinely contained
-- everything. The netting rule in e0dc482 removed exactly that: a new ask now
-- excludes whatever outstanding dues already claim, so each period asks only
-- its own increment and every one of them has to be chased on its own.
--
-- The per-generation true-up toggle (6497e48) makes it worse still: a flat ask
-- carries nothing by design, so it can never absorb an earlier period.
--
-- Settlement is computed on the party's dues as ONE running account —
-- Σ amount_due since the earliest open row, less that party's payments since
-- then. Settling each row against payments after ITS OWN issue date would count
-- a late payment once per row and clear debts that are still owed.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

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
  -- one row per party, covering EVERY period they still owe on
  agg AS (
    SELECT
      l.unit_id, l.building_id, l.eff_party, l.tenant_id, l.today,
      MIN(l.due_date)                       AS due_date,     -- the oldest still open
      MIN(l.created_at)                     AS since,
      SUM(l.amount_due)                     AS billed,
      COUNT(*)                              AS periods,
      -- the oldest label leads; the count tells the resident there are more
      (ARRAY_AGG(l.period_label ORDER BY l.due_date))[1] AS period_label
    FROM live l
    GROUP BY l.unit_id, l.building_id, l.eff_party, l.tenant_id, l.today
  ),
  settled AS (
    SELECT a.*,
      -- ONE running account: payments since the oldest open row. Settling each
      -- row against payments after its own issue date would count the same
      -- payment once per row.
      (SELECT COALESCE(SUM(p.amount_usd), 0) FROM payments p
        WHERE p.unit_id = a.unit_id AND p.voided_at IS NULL
          AND p.created_at >= a.since
          AND CASE WHEN a.eff_party = 'tenant'
                   THEN p.paid_by = 'tenant' AND (a.tenant_id IS NULL OR p.tenant_id = a.tenant_id)
                   ELSE p.paid_by IS DISTINCT FROM 'tenant' END) AS paid
    FROM agg a
  )
  SELECT
    s.unit_id, u.label, b.id, b.name,
    CASE WHEN s.periods > 1 THEN s.period_label || ' +' || (s.periods - 1) ELSE s.period_label END,
    s.due_date,
    GREATEST(0, ROUND(s.billed - s.paid, 2)),
    s.eff_party, s.tenant_id,
    (SELECT pr.full_name FROM profiles pr WHERE pr.id = s.tenant_id),
    (s.today > s.due_date) AS is_overdue,
    COALESCE((
      SELECT ARRAY_AGG(DISTINCT m.user_id) FROM memberships m
      WHERE m.unit_id = s.unit_id AND m.ended_at IS NULL
        AND ((s.eff_party = 'tenant' AND m.tenure = 'tenant'
                AND (s.tenant_id IS NULL OR m.user_id = s.tenant_id))
          OR (s.eff_party = 'owner'  AND m.tenure = 'owner'))
    ), ARRAY[]::UUID[])
  FROM settled s
  JOIN units u     ON u.id = s.unit_id
  JOIN buildings b ON b.id = s.building_id
  WHERE GREATEST(0, ROUND(s.billed - s.paid, 2)) > 0
    AND NOT EXISTS (
      SELECT 1 FROM reminders_sent rs
      WHERE rs.unit_id = s.unit_id AND rs.sent_on = s.today
        AND rs.party = s.eff_party AND rs.source = 'dues'
    );
$$;

REVOKE ALL     ON FUNCTION get_overdue_dues() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_overdue_dues() TO service_role;

COMMIT;

-- ============================================================
-- Post-run checks:
--   Q3 500 unpaid + a 200 flat ask due later
--     -> ONE row per party, amount_due 700, due_date = Q3's (the oldest),
--        period_label "2026-Q3 +1". Before this it returned 200.
--   Pay 500 -> the same row returns 200, not 0 and not 700.
--   is_overdue follows the OLDEST open period, so the escalation clock starts
--   from the debt that has been outstanding longest.
-- ============================================================
