-- ============================================================
-- 0142_overdue_units_mode_filter.sql
-- Transition audit MT3 (HIGH) + parity fixes on get_overdue_units (latest 0088).
--
-- MT3 — the arrears reminder query lost its billing-mode filter. 0056 had
--   `AND effective_billing_mode(b.id) = 'arrears'`; the 0088 rewrite dropped it.
--   So a building flipped arrears→dues keeps being chased by the arrears path
--   (off stale, never-cancelled payment_request_lines) AT THE SAME TIME as the
--   dues path — two reminders, same money, same day (different reminders_sent
--   'source'). Restoring the filter silences arrears dunning the moment a scope
--   is in dues mode — and fixes any building already flipped, independent of the
--   transition RPC (0143) that cancels the stale lines going forward.
--
-- Parity — also exclude soft-deleted units/buildings (0138 deleted_at), which
--   this SECURITY DEFINER function bypasses via RLS, exactly like the dues fix
--   in 0140. And a deterministic ORDER BY.
--
-- Body is 0088's verbatim otherwise (same RETURNS signature). Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION get_overdue_units()
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
    SELECT l.id, l.unit_id, l.building_id, l.tenant_id, r.label, r.due_date, r.requested_on, t.d,
           effective_obligation_party(l.unit_id, l.party, l.tenant_id) AS eff_party,
           request_line_outstanding(l.id) AS owed
    FROM payment_request_lines l
    JOIN payment_requests r ON r.id = l.request_id
    JOIN buildings b        ON b.id = l.building_id AND b.is_active = true AND b.deleted_at IS NULL  -- 0142 parity
    CROSS JOIN today t
    WHERE l.cancelled_at IS NULL
      AND reminder_is_send_day(t.d, r.requested_on, r.due_date)
      AND effective_billing_mode(l.building_id) = 'arrears'   -- 0142 (MT3): stop chasing a scope flipped to dues
      AND EXISTS (SELECT 1 FROM units u WHERE u.id = l.unit_id AND u.deleted_at IS NULL)  -- 0142 parity
  ),
  agg AS (
    SELECT
      v.unit_id, v.building_id, v.eff_party, v.d,
      (ARRAY_AGG(v.tenant_id) FILTER (WHERE v.tenant_id IS NOT NULL))[1] AS tenant_id,
      SUM(v.owed)                    AS owed,
      MIN(v.due_date)                AS due_date,
      COUNT(*)                       AS n,
      (ARRAY_AGG(v.label ORDER BY v.due_date))[1] AS label
    FROM live v
    WHERE v.owed > 0
    GROUP BY v.unit_id, v.building_id, v.eff_party, v.d
  )
  SELECT
    a.unit_id, u.label, b.id, b.name,
    ROUND(a.owed, 2),
    CASE WHEN a.n > 1 THEN COALESCE(a.label, '') || ' +' || (a.n - 1) ELSE a.label END,
    a.due_date,
    (a.d > a.due_date) AS is_overdue, a.eff_party,
    recips.ids
  FROM agg a
  JOIN units u     ON u.id = a.unit_id     AND u.deleted_at IS NULL
  JOIN buildings b ON b.id = a.building_id AND b.deleted_at IS NULL
  CROSS JOIN LATERAL (
    SELECT COALESCE(ARRAY_AGG(DISTINCT m.user_id), ARRAY[]::UUID[]) AS ids
    FROM memberships m
    WHERE m.unit_id = a.unit_id AND m.ended_at IS NULL
      AND ((a.eff_party = 'tenant' AND m.tenure = 'tenant'
              AND (a.tenant_id IS NULL OR m.user_id = a.tenant_id))
        OR (a.eff_party = 'owner'  AND m.tenure = 'owner'))
  ) recips
  WHERE cardinality(recips.ids) > 0
    AND NOT EXISTS (
      SELECT 1 FROM reminders_sent rs
      WHERE rs.unit_id = a.unit_id AND rs.sent_on = a.d
        AND rs.party = a.eff_party AND rs.source = 'arrears'
    )
  ORDER BY b.name, u.label, a.eff_party;   -- 0142: deterministic
$$;

COMMIT;

-- Post-run checks:
--   Flip an arrears building with an open request to dues → arrears reminders
--     stop for it (get_overdue_units no longer returns it); only the dues path chases.
--   Normal arrears building → still chased as before.
--   Soft-deleted unit/building → no longer chased.
