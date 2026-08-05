-- ============================================================
-- 0088_request_asof.sql
-- A payment request can target a PERIOD, not just "now" (expert session,
-- 2026-08-05).
--
-- Ahmad's case: it is August 5th and the admin wants July settled — NOT the
-- charges that landed August 1–5. So the request takes an optional AS-OF date:
--
--   amount = what the party owed AT that date
--          − their payments dated AFTER it (up to the moment of the request)
--
-- The second term is the part Ahmad flagged himself: someone who owed 500 on
-- July 31 and paid 300 on August 2 must be asked for 200, not 500 — payments
-- since the cutoff already settled part of that older debt. Charges since the
-- cutoff are exactly what the as-of is there to exclude.
--
-- SETTLEMENT MOVES TO created_at. Lines used to settle by paid_on >=
-- requested_on, which now collides with as-of netting: a payment DATED between
-- the as-of and the request would be subtracted at issue AND counted again at
-- settlement (dated on the request day), or missed by both if entered later.
-- Settling by entry time (p.created_at >= r.created_at) is airtight: whatever
-- was already entered is netted at issue, whatever is entered after settles the
-- line — no gap, no double-count, whatever the payment's value date. (A payment
-- entered after the request but BACKDATED before the as-of also settles it —
-- conservative, in the resident's favor.)
--
-- get_overdue_units also learns the 0082 lesson: one reminder row per
-- unit+party summing EVERY open line (a targeted extraordinary request and a
-- general one can be open at once, 0089), dated from the oldest, instead of
-- per-line rows fighting over the daily dedup slot. And a line whose unit has
-- NOBODY to notify is skipped BEFORE the dedup insert — 2West taught us a
-- reminder that reaches no one must not look delivered in the audit trail.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS as_of DATE;
COMMENT ON COLUMN payment_requests.as_of IS
  'The request asks for the balance AS OF this date, net of payments made after it. NULL = the balance at issue time.';

-- ------------------------------------------------------------
-- unit_party_balance (0064), at a point in time. Value-date cutoffs, same as
-- unit_balance_asof (0033): charge_date / paid_on / effective_date /
-- opening_balance_date ≤ the as-of.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS unit_party_balance_asof(UUID, TEXT, DATE);
CREATE FUNCTION unit_party_balance_asof(p_unit UUID, p_party TEXT, p_asof DATE)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT ROUND(
      CASE WHEN p_party IS NULL OR p_party = 'owner'
           THEN COALESCE((SELECT opening_balance FROM units WHERE id = p_unit
                            AND (opening_balance_date IS NULL OR opening_balance_date <= p_asof)), 0) ELSE 0 END
    + COALESCE((SELECT SUM(amount_usd) FROM payments
                 WHERE unit_id = p_unit AND voided_at IS NULL AND paid_on <= p_asof
                   AND (p_party IS NULL OR paid_by = p_party)), 0)
    - COALESCE((SELECT SUM(amount_usd) FROM charges
                 WHERE unit_id = p_unit AND voided_at IS NULL AND charge_date <= p_asof
                   AND (p_party IS NULL
                        OR (p_party = 'owner'  AND billed_to IN ('owner','both'))
                        OR (p_party = 'tenant' AND billed_to = 'tenant'))), 0)
    + COALESCE((SELECT SUM(adjustment_effect(kind, amount_usd)) FROM adjustments
                 WHERE unit_id = p_unit AND voided_at IS NULL AND effective_date <= p_asof
                   AND (p_party IS NULL OR party = p_party)), 0)
  , 2);
$$;
GRANT EXECUTE ON FUNCTION unit_party_balance_asof(UUID, TEXT, DATE) TO authenticated;

-- that party's payments dated AFTER the as-of (already entered)
DROP FUNCTION IF EXISTS party_payments_after(UUID, TEXT, DATE);
CREATE FUNCTION party_payments_after(p_unit UUID, p_party TEXT, p_after DATE)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(SUM(amount_usd), 0) FROM payments
  WHERE unit_id = p_unit AND voided_at IS NULL AND paid_on > p_after
    AND CASE WHEN p_party = 'tenant' THEN paid_by = 'tenant'
             ELSE paid_by IS DISTINCT FROM 'tenant' END;
$$;
GRANT EXECUTE ON FUNCTION party_payments_after(UUID, TEXT, DATE) TO authenticated;

-- ------------------------------------------------------------
-- request_payment gains p_as_of. Arrears-only (0081), supersedes open
-- requests (0079), party-aware (0076) — all preserved.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS request_payment(TEXT, UUID, TEXT, INT);
CREATE OR REPLACE FUNCTION request_payment(
  p_scope_type TEXT,
  p_scope_id   UUID,
  p_label      TEXT DEFAULT NULL,
  p_due_days   INT  DEFAULT NULL,
  p_as_of      DATE DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ids UUID[];
  v_req UUID;
  v_days INT;
BEGIN
  IF p_scope_type = 'building' THEN
    v_ids := ARRAY[p_scope_id];
  ELSIF p_scope_type = 'compound' THEN
    SELECT array_agg(id) INTO v_ids FROM buildings WHERE compound_id = p_scope_id;
  ELSE
    RAISE EXCEPTION 'Unknown scope %', p_scope_type USING ERRCODE = '22023';
  END IF;

  IF v_ids IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(v_ids) id
      WHERE is_platform_admin() OR user_can(id, 'charge.manage')) THEN
    RAISE EXCEPTION 'Not allowed to request payment here.' USING ERRCODE = '42501';
  END IF;

  IF p_as_of IS NOT NULL AND p_as_of > CURRENT_DATE THEN
    RAISE EXCEPTION 'The as-of date cannot be in the future.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(v_ids) id WHERE effective_billing_mode(id) = 'dues') THEN
    RAISE EXCEPTION 'This building bills by dues. Raise a one-off with a flat budget instead.'
      USING ERRCODE = 'P0001';
  END IF;

  v_days := COALESCE(p_due_days, effective_due_days(v_ids[1]));

  UPDATE payment_request_lines l
     SET cancelled_at = now()
   WHERE l.cancelled_at IS NULL
     AND l.building_id = ANY(v_ids);

  INSERT INTO payment_requests (building_id, compound_id, label, due_date, as_of, created_by)
  VALUES (
    CASE WHEN p_scope_type = 'building' THEN p_scope_id END,
    CASE WHEN p_scope_type = 'compound' THEN p_scope_id END,
    NULLIF(btrim(COALESCE(p_label, '')), ''),
    CURRENT_DATE + v_days,
    p_as_of,
    auth.uid())
  RETURNING id INTO v_req;

  INSERT INTO payment_request_lines (request_id, unit_id, building_id, party, tenant_id, amount_requested)
  SELECT v_req, u.id, u.building_id, pb.party,
         CASE WHEN pb.party = 'tenant' THEN (
           SELECT m.user_id FROM memberships m
           WHERE m.unit_id = u.id AND m.tenure = 'tenant' AND m.ended_at IS NULL
           ORDER BY m.created_at DESC LIMIT 1) END,
         pb.owed
  FROM units u
  CROSS JOIN LATERAL (
    -- as-of: owed at the cutoff, net of payments dated after it.
    -- live: the current balance (unchanged behavior).
    SELECT 'owner'::TEXT AS party,
           CASE WHEN p_as_of IS NULL
                THEN ROUND(-unit_party_balance(u.id, 'owner'), 2)
                ELSE ROUND(-unit_party_balance_asof(u.id, 'owner', p_as_of)
                           - party_payments_after(u.id, 'owner', p_as_of), 2) END AS owed
    UNION ALL
    SELECT 'tenant',
           CASE WHEN p_as_of IS NULL
                THEN ROUND(-unit_party_balance(u.id, 'tenant'), 2)
                ELSE ROUND(-unit_party_balance_asof(u.id, 'tenant', p_as_of)
                           - party_payments_after(u.id, 'tenant', p_as_of), 2) END
  ) pb
  WHERE u.building_id = ANY(v_ids) AND pb.owed > 0;

  RETURN v_req;
END;
$$;
GRANT EXECUTE ON FUNCTION request_payment(TEXT, UUID, TEXT, INT, DATE) TO authenticated;

-- ------------------------------------------------------------
-- Settlement by ENTRY time (see header).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_line_outstanding(p_line UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT GREATEST(0, ROUND(l.amount_requested - COALESCE((
    SELECT SUM(p.amount_usd) FROM payments p
    WHERE p.unit_id = l.unit_id AND p.voided_at IS NULL
      AND p.created_at >= r.created_at
      AND CASE WHEN l.party = 'tenant'
               THEN p.paid_by = 'tenant' AND (l.tenant_id IS NULL OR p.tenant_id = l.tenant_id)
               ELSE p.paid_by IS DISTINCT FROM 'tenant' END
  ), 0), 2))
  FROM payment_request_lines l
  JOIN payment_requests r ON r.id = l.request_id
  WHERE l.id = p_line;
$$;

-- ------------------------------------------------------------
-- One reminder row per unit+party, summing every open line (0082 pattern);
-- recipient-less candidates skipped before they can burn a dedup slot.
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
    SELECT l.id, l.unit_id, l.building_id, l.tenant_id, r.label, r.due_date, r.requested_on, t.d,
           effective_obligation_party(l.unit_id, l.party, l.tenant_id) AS eff_party,
           request_line_outstanding(l.id) AS owed
    FROM payment_request_lines l
    JOIN payment_requests r ON r.id = l.request_id
    JOIN buildings b        ON b.id = l.building_id AND b.is_active = true
    CROSS JOIN today t
    WHERE l.cancelled_at IS NULL
      AND reminder_is_send_day(t.d, r.requested_on, r.due_date)
  ),
  agg AS (
    SELECT
      v.unit_id, v.building_id, v.eff_party, v.d,
      -- the newest tenant id among the lines (they agree in practice)
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
  JOIN units u     ON u.id = a.unit_id
  JOIN buildings b ON b.id = a.building_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(ARRAY_AGG(DISTINCT m.user_id), ARRAY[]::UUID[]) AS ids
    FROM memberships m
    WHERE m.unit_id = a.unit_id AND m.ended_at IS NULL
      AND ((a.eff_party = 'tenant' AND m.tenure = 'tenant'
              AND (a.tenant_id IS NULL OR m.user_id = a.tenant_id))
        OR (a.eff_party = 'owner'  AND m.tenure = 'owner'))
  ) recips
  WHERE cardinality(recips.ids) > 0        -- nobody to notify → not a candidate
    AND NOT EXISTS (
      SELECT 1 FROM reminders_sent rs
      WHERE rs.unit_id = a.unit_id AND rs.sent_on = a.d
        AND rs.party = a.eff_party AND rs.source = 'arrears'
    );
$$;

REVOKE ALL     ON FUNCTION get_overdue_units() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_overdue_units() TO service_role;

COMMIT;

-- ============================================================
-- Post-run checks:
--   SELECT request_payment('building','<id>','July balances', 7, DATE '2026-07-31');
--     -> a unit charged in August is asked its JULY position; a payment made
--        August 2nd reduces the ask.
--   Two open requests (extraordinary + general, 0089) on one unit -> ONE row
--   from get_overdue_units() summing both, labelled "… +1".
--   A unit with no memberships never appears (and burns no dedup slot).
-- ============================================================
