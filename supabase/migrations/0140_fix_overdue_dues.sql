-- ============================================================
-- 0140_fix_overdue_dues.sql
-- DUES deep-dive fixes D2 + D3, both inside get_overdue_dues() (latest was 0125).
--
-- D2 (MONEY) — split owner groups double-count the owner's payment and drop
--   reminders. The function GROUPed by tenant_id, so two dues from two DEPARTED
--   tenants (both remapped to eff_party='owner') formed TWO owner groups keeping
--   distinct tenant_ids. The owner-payment match has no tenant_id filter, so one
--   payment was summed against both groups (over-crediting → owed amount never
--   chased); and the reminders_sent dedup (unit,day,party,source) swallowed one
--   group's email. FIX: collapse owner-remapped dues to a single group by using
--   a NULL group-tenant whenever eff_party='owner'. One summed owner obligation,
--   one payment counted once, one reminder.
--
-- D3 — soft-deleted units/buildings kept being dunned. get_overdue_dues is
--   SECURITY DEFINER (bypasses the 0138 hide_deleted RLS) and filtered on
--   b.is_active, not deleted_at. FIX: exclude buildings AND units where
--   deleted_at IS NOT NULL, at candidacy time and in the final joins.
--
-- Also: a deterministic ORDER BY (the old function had none, so which of two
--   colliding rows survived was nondeterministic day to day).
--
-- Body is 0125's verbatim otherwise (same RETURNS signature). Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION get_overdue_dues()
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
           effective_obligation_party(d.unit_id, d.billed_to, d.tenant_id) AS eff_party,
           -- 0140 (D2): owner-remapped dues collapse to one group (tenant NULL),
           -- so a departed tenant's identity never splits the owner's obligation.
           CASE WHEN effective_obligation_party(d.unit_id, d.billed_to, d.tenant_id) = 'owner'
                THEN NULL ELSE d.tenant_id END AS grp_tenant
    FROM dues d
    CROSS JOIN today t
    JOIN buildings b ON b.id = d.building_id AND b.is_active = true AND b.deleted_at IS NULL  -- 0140 (D3)
    WHERE d.due_date IS NOT NULL
      AND effective_billing_mode(d.building_id) = 'dues'
      AND d.amount_due > 0
      AND reminder_is_send_day(t.d, d.created_at::date, d.due_date)
      AND EXISTS (SELECT 1 FROM units u WHERE u.id = d.unit_id AND u.deleted_at IS NULL)       -- 0140 (D3)
  ),
  agg AS (
    SELECT
      l.unit_id, l.building_id, l.eff_party, l.grp_tenant AS tenant_id, l.today,
      MIN(l.due_date)                       AS due_date,
      MIN(l.created_at)                     AS since,
      SUM(l.amount_due)                     AS billed,
      COUNT(*)                              AS periods,
      (ARRAY_AGG(l.period_label ORDER BY l.due_date))[1] AS period_label
    FROM live l
    GROUP BY l.unit_id, l.building_id, l.eff_party, l.grp_tenant, l.today
  ),
  settled AS (
    SELECT a.*,
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
    recips.ids
  FROM settled s
  JOIN units u     ON u.id = s.unit_id     AND u.deleted_at IS NULL   -- 0140 (D3) belt-and-braces
  JOIN buildings b ON b.id = s.building_id AND b.deleted_at IS NULL
  CROSS JOIN LATERAL (
    SELECT COALESCE(ARRAY_AGG(DISTINCT m.user_id), ARRAY[]::UUID[]) AS ids
    FROM memberships m
    WHERE m.unit_id = s.unit_id AND m.ended_at IS NULL
      AND ((s.eff_party = 'tenant' AND m.tenure = 'tenant'
              AND (s.tenant_id IS NULL OR m.user_id = s.tenant_id))
        OR (s.eff_party = 'owner'  AND m.tenure = 'owner'))
  ) recips
  WHERE GREATEST(0, ROUND(s.billed - s.paid, 2)) > 0
    AND cardinality(recips.ids) > 0
    AND NOT EXISTS (
      SELECT 1 FROM reminders_sent rs
      WHERE rs.unit_id = s.unit_id AND rs.sent_on = s.today
        AND rs.party = s.eff_party AND rs.source = 'dues'
    )
  ORDER BY b.name, u.label, s.eff_party;   -- 0140: deterministic
$$;

COMMIT;

-- Post-run checks:
--   A unit with TWO departed-tenant dues + one owner payment → get_overdue_dues
--     returns ONE owner row with billed=Σ, paid counted once, correct owed.
--   Soft-delete a dues-mode unit (or its building) → it no longer appears in
--     get_overdue_dues (was: kept being reminded via the cron).
--   Normal owner/tenant dues → unchanged.
