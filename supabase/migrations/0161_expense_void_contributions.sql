-- ============================================================
-- 0161_expense_void_contributions.sql
-- Expenses join the void discipline; "special charges" become
-- CONTRIBUTIONS (Jey's QA round 4, 2026-08-29).
--
-- 1. EXPENSES ARE MONEY RECORDS: voided, never deleted. New voided_at/
--    voided_by/void_reason columns + the sealed void_expense() door - it
--    voids the expense AND its live charges, cancels the expense's own
--    request lines (extraordinary asks die with it), and sends the billed
--    parties one in-app notice. Metered expenses refuse (the cycle is the
--    source of truth). The client's hard-delete is gone.
--    fund_position() restated with `voided_at IS NULL` on every expenses
--    predicate (exo / unrec / unattr) - a voided expense leaves the cash
--    math everywhere at once. The client twin gets the same filter in the
--    same commit.
--
-- 2. NAMING: the postpaid direct-billing entity now reads "Contribution"
--    in every user-facing string, including the DB-written notification
--    titles ('Contribution updated' / 'Contribution removed') - the three
--    RPCs are restated from 0158/0160 verbatim + wording only. The tables
--    keep their special_charges names (rename = churn, zero user value).
--
-- Additive & idempotent.
-- ============================================================
BEGIN;
SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------------------
-- 1. Void columns + the door.
-- ------------------------------------------------------------
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_by   UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS void_reason TEXT;

CREATE OR REPLACE FUNCTION void_expense(p_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_exp expenses;
BEGIN
  SELECT * INTO v_exp FROM expenses WHERE id = p_id FOR UPDATE;
  IF v_exp.id IS NULL THEN RAISE EXCEPTION 'Expense not found.' USING ERRCODE = '22023'; END IF;
  IF NOT (is_platform_admin()
    OR (v_exp.building_id IS NOT NULL AND user_can(v_exp.building_id, 'expense.manage'))
    OR (v_exp.compound_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM buildings b WHERE b.compound_id = v_exp.compound_id
            AND user_can(b.id, 'expense.manage')))) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  IF v_exp.meter_cycle_id IS NOT NULL THEN
    RAISE EXCEPTION 'This expense was posted by a metering cycle — manage it from the Metering tab.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_exp.voided_at IS NOT NULL THEN RETURN; END IF;

  -- one in-app notice per billed person, captured from the still-live charges
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT DISTINCT m.user_id, c.building_id, 'expense_voided',
         'Charges removed', v_exp.description || ' — it no longer appears on your statement.'
  FROM charges c
  JOIN memberships m ON m.unit_id = c.unit_id AND m.ended_at IS NULL
  WHERE c.expense_id = p_id AND c.voided_at IS NULL
    AND ((c.billed_to = 'tenant' AND m.tenure = 'tenant'
            AND (c.tenant_id IS NULL OR m.user_id = c.tenant_id))
      OR (c.billed_to <> 'tenant' AND m.tenure = 'owner'));

  UPDATE charges SET voided_at = now(), voided_by = auth.uid(), void_reason = 'Expense voided'
   WHERE expense_id = p_id AND voided_at IS NULL;
  UPDATE payment_request_lines l SET cancelled_at = now()
    FROM payment_requests r
   WHERE r.id = l.request_id AND r.expense_id = p_id AND l.cancelled_at IS NULL;
  UPDATE expenses SET voided_at = now(), voided_by = auth.uid(), void_reason = NULLIF(btrim(COALESCE(p_reason, '')), '')
   WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION void_expense(UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 2. fund_position: a voided expense leaves the cash math (0153 body
--    verbatim + `x.voided_at IS NULL` in exo, unrec and unattr).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fund_position(UUID[], DATE);
CREATE OR REPLACE FUNCTION fund_position(
  p_building_ids UUID[],
  p_to           DATE DEFAULT NULL
)
RETURNS TABLE(
  opening       NUMERIC,
  payments_in   NUMERIC,
  other_in      NUMERIC,
  expenses_out  NUMERIC,
  other_out     NUMERIC,
  refunds_out   NUMERIC,
  cash          NUMERIC,
  credits       NUMERIC,
  arrears       NUMERIC,
  available     NUMERIC,
  reserve       NUMERIC,
  fund_paid     NUMERIC,
  unreconciled  INT,
  cash_usd      NUMERIC,
  cash_lbp      NUMERIC,
  unattributed  INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_seen      UUID[];
  v_ids       UUID[];
  v_comp      UUID[];
  v_blockcomp UUID[];
  v_to        DATE := COALESCE(p_to, CURRENT_DATE);
BEGIN
  SELECT array_agg(id) INTO v_seen
  FROM unnest(p_building_ids) AS id
  WHERE is_platform_admin() OR user_can(id, 'finance.view') OR user_member_building(id);
  IF v_seen IS NULL THEN RETURN; END IF;

  SELECT array_agg(DISTINCT b.compound_id) INTO v_comp
  FROM buildings b JOIN compounds c ON c.id = b.compound_id
  WHERE b.id = ANY(v_seen) AND c.fund_scope = 'compound';
  SELECT array_agg(DISTINCT b.compound_id) INTO v_blockcomp
  FROM buildings b JOIN compounds c ON c.id = b.compound_id
  WHERE b.id = ANY(v_seen) AND c.fund_scope = 'block';
  SELECT array_agg(DISTINCT b.id) INTO v_ids
  FROM buildings b
  WHERE b.id = ANY(v_seen)
     OR (v_comp IS NOT NULL AND b.compound_id = ANY(v_comp));

  RETURN QUERY
  WITH
  op AS (
    SELECT COALESCE(SUM(f.opening_balance_usd
             + COALESCE(ROUND(f.opening_balance_lbp / NULLIF(f.opening_lbp_rate, 0), 2), 0)), 0) AS v,
           COALESCE(SUM(f.opening_balance_usd), 0)               AS usd,
           COALESCE(SUM(COALESCE(f.opening_balance_lbp, 0)), 0)  AS lbp
    FROM funds f
    WHERE (
            (f.building_id = ANY(v_ids) AND f.building_id IN (
               SELECT b.id FROM buildings b LEFT JOIN compounds c ON c.id = b.compound_id
               WHERE b.compound_id IS NULL OR c.fund_scope = 'block'))
            OR (v_comp IS NOT NULL AND f.compound_id = ANY(v_comp))
          )
      AND (f.opening_date IS NULL OR f.opening_date <= v_to)
  ),
  pin AS (
    SELECT COALESCE(SUM(p.amount_usd), 0) AS v,
           COALESCE(SUM(ROUND(p.amount_usd - COALESCE(p.amount_lbp / NULLIF(p.lbp_rate, 0), 0), 2)), 0) AS usd,
           COALESCE(SUM(COALESCE(p.amount_lbp, 0)), 0) AS lbp
    FROM payments p
    WHERE p.building_id = ANY(v_ids) AND p.voided_at IS NULL AND p.paid_on <= v_to
  ),
  oin AS (
    SELECT COALESCE(SUM(e.amount_usd), 0) AS v,
           COALESCE(SUM(ROUND(e.amount_usd - COALESCE(e.amount_lbp / NULLIF(e.lbp_rate, 0), 0), 2)), 0) AS usd,
           COALESCE(SUM(COALESCE(e.amount_lbp, 0)), 0) AS lbp
    FROM fund_entries e
    WHERE e.kind = 'income' AND e.voided_at IS NULL AND e.entry_date <= v_to
      AND (e.building_id = ANY(v_ids) OR (v_comp IS NOT NULL AND e.compound_id = ANY(v_comp)))
  ),
  exo AS (
    SELECT COALESCE(SUM(x.amount_usd), 0) AS v,
           COALESCE(SUM(x.funded_by_fund_usd), 0) AS fp,
           COALESCE(SUM(ROUND(x.amount_usd - COALESCE(x.amount_lbp / NULLIF(x.lbp_rate, 0), 0), 2)), 0) AS usd,
           COALESCE(SUM(COALESCE(x.amount_lbp, 0)), 0) AS lbp
    FROM expenses x
    WHERE x.expense_date <= v_to
      AND x.voided_at IS NULL
      AND (COALESCE(x.paid_from_building_id, x.building_id) = ANY(v_ids)
           OR (v_comp IS NOT NULL AND x.compound_id = ANY(v_comp)))
  ),
  oout AS (
    SELECT COALESCE(SUM(e.amount_usd), 0) AS v,
           COALESCE(SUM(ROUND(e.amount_usd - COALESCE(e.amount_lbp / NULLIF(e.lbp_rate, 0), 0), 2)), 0) AS usd,
           COALESCE(SUM(COALESCE(e.amount_lbp, 0)), 0) AS lbp
    FROM fund_entries e
    WHERE e.kind = 'outflow' AND e.voided_at IS NULL AND e.entry_date <= v_to
      AND (e.building_id = ANY(v_ids) OR (v_comp IS NOT NULL AND e.compound_id = ANY(v_comp)))
  ),
  ref AS (
    SELECT COALESCE(SUM(a.amount_usd), 0) AS v,
           COALESCE(SUM(ROUND(a.amount_usd - COALESCE(a.amount_lbp / NULLIF(a.lbp_rate, 0), 0), 2)), 0) AS usd,
           COALESCE(SUM(COALESCE(a.amount_lbp, 0)), 0) AS lbp
    FROM adjustments a
    WHERE a.building_id = ANY(v_ids) AND a.kind = 'refund' AND a.voided_at IS NULL
      AND a.effective_date <= v_to
  ),
  bal AS (
    SELECT
      COALESCE(SUM(GREATEST(0,  unit_balance_asof(u.id, v_to))), 0) AS cr,
      COALESCE(SUM(GREATEST(0, -unit_balance_asof(u.id, v_to))), 0) AS ar
    FROM units u
    WHERE u.building_id = ANY(v_ids) AND u.created_at::date <= v_to
  ),
  unrec AS (
    SELECT COUNT(*)::int AS n
    FROM expenses x
    LEFT JOIN (SELECT expense_id, SUM(amount_usd) AS billed FROM charges
                WHERE voided_at IS NULL GROUP BY expense_id) c ON c.expense_id = x.id
    WHERE x.expense_date <= v_to
      AND x.voided_at IS NULL
      AND (COALESCE(x.paid_from_building_id, x.building_id) = ANY(v_ids)
           OR (v_comp IS NOT NULL AND x.compound_id = ANY(v_comp)))
      AND ABS(x.amount_usd - COALESCE(c.billed, 0) - x.funded_by_fund_usd) > 0.005
  ),
  unattr AS (
    SELECT (COALESCE((SELECT COUNT(*) FROM expenses x
              WHERE v_blockcomp IS NOT NULL AND x.compound_id = ANY(v_blockcomp)
                AND x.building_id IS NULL AND x.paid_from_building_id IS NULL
                AND x.voided_at IS NULL
                AND x.expense_date <= v_to), 0)
          + COALESCE((SELECT COUNT(*) FROM fund_entries e
              WHERE v_blockcomp IS NOT NULL AND e.compound_id = ANY(v_blockcomp)
                AND e.building_id IS NULL AND e.voided_at IS NULL
                AND e.entry_date <= v_to), 0))::int AS n
  )
  SELECT
    ROUND(op.v, 2), ROUND(pin.v, 2), ROUND(oin.v, 2), ROUND(exo.v, 2), ROUND(oout.v, 2), ROUND(ref.v, 2),
    ROUND(op.v + pin.v + oin.v - exo.v - oout.v - ref.v, 2)                       AS cash,
    ROUND(bal.cr, 2), ROUND(bal.ar, 2),
    ROUND(op.v + pin.v + oin.v - exo.v - oout.v - ref.v - bal.cr, 2)              AS available,
    ROUND(op.v + pin.v + oin.v - exo.v - oout.v - ref.v - bal.cr + bal.ar, 2)     AS reserve,
    ROUND(exo.fp, 2), unrec.n,
    ROUND(op.usd + pin.usd + oin.usd - exo.usd - oout.usd - ref.usd, 2)           AS cash_usd,
    ROUND(op.lbp + pin.lbp + oin.lbp - exo.lbp - oout.lbp - ref.lbp, 2)           AS cash_lbp,
    unattr.n
  FROM op, pin, oin, exo, oout, ref, bal, unrec, unattr;
END;
$$;
GRANT EXECUTE ON FUNCTION fund_position(UUID[], DATE) TO authenticated;

-- ------------------------------------------------------------
-- 3. Contribution wording in the sealed doors (0158/0160 verbatim +
--    strings only; behavior identical).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_special_charge(
  p_scope_type TEXT,
  p_scope_id   UUID,
  p_label      TEXT,
  p_rows       JSONB,
  p_method     TEXT DEFAULT 'by_shares',
  p_billed_to  TEXT DEFAULT 'owner',
  p_request    BOOLEAN DEFAULT TRUE,
  p_due_days   INT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ids   UUID[];
  v_sc    UUID;
  v_req   UUID;
  v_total NUMERIC;
  v_days  INT;
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
    RAISE EXCEPTION 'Not allowed to issue a contribution here.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ids) id WHERE effective_billing_mode(id) = 'dues') THEN
    RAISE EXCEPTION 'This scope bills prepaid. Use the Prepaid page''s special charge instead.'
      USING ERRCODE = 'P0001';
  END IF;
  IF btrim(COALESCE(p_label, '')) = '' THEN
    RAISE EXCEPTION 'The contribution needs a label.' USING ERRCODE = '22023';
  END IF;
  IF p_method NOT IN ('by_shares', 'equal') OR p_billed_to NOT IN ('owner', 'tenant') THEN
    RAISE EXCEPTION 'Invalid method or party.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) r
    LEFT JOIN units u ON u.id = (r->>'unit_id')::uuid AND u.deleted_at IS NULL
    WHERE u.id IS NULL OR NOT (u.building_id = ANY(v_ids)) OR COALESCE((r->>'amount')::numeric, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'A row names a unit outside this scope, or a non-positive amount.' USING ERRCODE = '22023';
  END IF;
  SELECT ROUND(SUM((r->>'amount')::numeric), 2) INTO v_total FROM jsonb_array_elements(p_rows) r;
  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'Nothing to charge.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO special_charges (building_id, compound_id, label, total_usd, method, billed_to, created_by)
  VALUES (
    CASE WHEN p_scope_type = 'building' THEN p_scope_id END,
    CASE WHEN p_scope_type = 'compound' THEN p_scope_id END,
    btrim(p_label), v_total, p_method, p_billed_to, auth.uid())
  RETURNING id INTO v_sc;

  INSERT INTO charges (special_charge_id, unit_id, building_id, category, description,
                       amount_usd, charge_date, billed_to, tenant_id, created_by)
  SELECT v_sc, u.id, u.building_id, 'other', btrim(p_label),
         ROUND((r->>'amount')::numeric, 2), CURRENT_DATE,
         CASE WHEN p_billed_to = 'tenant' AND tn.user_id IS NOT NULL THEN 'tenant' ELSE 'owner' END,
         CASE WHEN p_billed_to = 'tenant' THEN tn.user_id END,
         auth.uid()
  FROM jsonb_array_elements(p_rows) r
  JOIN units u ON u.id = (r->>'unit_id')::uuid
  LEFT JOIN LATERAL (
    SELECT m.user_id FROM memberships m
    WHERE m.unit_id = u.id AND m.tenure = 'tenant' AND m.ended_at IS NULL
    ORDER BY m.created_at DESC LIMIT 1
  ) tn ON TRUE;

  IF p_request THEN
    v_days := COALESCE(p_due_days, effective_due_days(v_ids[1]));
    UPDATE payment_request_lines l SET cancelled_at = now()
     WHERE l.cancelled_at IS NULL AND l.building_id = ANY(v_ids);
    INSERT INTO payment_requests (building_id, compound_id, label, due_date, special_charge_id, created_by)
    VALUES (
      CASE WHEN p_scope_type = 'building' THEN p_scope_id END,
      CASE WHEN p_scope_type = 'compound' THEN p_scope_id END,
      btrim(p_label), CURRENT_DATE + v_days, v_sc, auth.uid())
    RETURNING id INTO v_req;
    INSERT INTO payment_request_lines (request_id, unit_id, building_id, party, tenant_id, amount_requested)
    SELECT v_req, c.unit_id, c.building_id,
           CASE WHEN c.billed_to = 'tenant' THEN 'tenant' ELSE 'owner' END,
           CASE WHEN c.billed_to = 'tenant' THEN c.tenant_id END,
           ask.v
    FROM charges c
    CROSS JOIN LATERAL (
      SELECT LEAST(c.amount_usd, GREATEST(0,
        -unit_party_balance(c.unit_id, CASE WHEN c.billed_to = 'tenant' THEN 'tenant' ELSE 'owner' END)
      )) AS v
    ) ask
    WHERE c.special_charge_id = v_sc AND ask.v > 0.005;
  END IF;

  RETURN v_sc;
END;
$$;
GRANT EXECUTE ON FUNCTION create_special_charge(TEXT, UUID, TEXT, JSONB, TEXT, TEXT, BOOLEAN, INT) TO authenticated;

CREATE OR REPLACE FUNCTION update_special_charge(
  p_id        UUID,
  p_label     TEXT,
  p_rows      JSONB,
  p_method    TEXT DEFAULT 'by_shares',
  p_billed_to TEXT DEFAULT 'owner',
  p_request   BOOLEAN DEFAULT FALSE,
  p_due_days  INT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sc    special_charges;
  v_ids   UUID[];
  v_req   UUID;
  v_total NUMERIC;
  v_days  INT;
BEGIN
  SELECT * INTO v_sc FROM special_charges WHERE id = p_id FOR UPDATE;
  IF v_sc.id IS NULL THEN RAISE EXCEPTION 'Contribution not found.' USING ERRCODE = '22023'; END IF;
  IF v_sc.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'This contribution was voided - issue a new one instead.' USING ERRCODE = 'P0001';
  END IF;
  IF v_sc.building_id IS NOT NULL THEN
    v_ids := ARRAY[v_sc.building_id];
  ELSE
    SELECT array_agg(id) INTO v_ids FROM buildings WHERE compound_id = v_sc.compound_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(v_ids) id
                  WHERE is_platform_admin() OR user_can(id, 'charge.manage')) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_label, '')) = '' THEN
    RAISE EXCEPTION 'The contribution needs a label.' USING ERRCODE = '22023';
  END IF;
  IF p_method NOT IN ('by_shares', 'equal') OR p_billed_to NOT IN ('owner', 'tenant') THEN
    RAISE EXCEPTION 'Invalid method or party.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) r
    LEFT JOIN units u ON u.id = (r->>'unit_id')::uuid AND u.deleted_at IS NULL
    WHERE u.id IS NULL OR NOT (u.building_id = ANY(v_ids)) OR COALESCE((r->>'amount')::numeric, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'A row names a unit outside this scope, or a non-positive amount.' USING ERRCODE = '22023';
  END IF;
  SELECT ROUND(SUM((r->>'amount')::numeric), 2) INTO v_total FROM jsonb_array_elements(p_rows) r;
  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'Nothing to charge.' USING ERRCODE = '22023';
  END IF;

  UPDATE charges SET voided_at = now(), voided_by = auth.uid(), void_reason = 'Contribution edited'
   WHERE special_charge_id = p_id AND voided_at IS NULL;
  UPDATE special_charges
     SET label = btrim(p_label), total_usd = v_total, method = p_method, billed_to = p_billed_to
   WHERE id = p_id;

  INSERT INTO charges (special_charge_id, unit_id, building_id, category, description,
                       amount_usd, charge_date, billed_to, tenant_id, created_by, notify_suppressed)
  SELECT p_id, u.id, u.building_id, 'other', btrim(p_label),
         ROUND((r->>'amount')::numeric, 2), CURRENT_DATE,
         CASE WHEN p_billed_to = 'tenant' AND tn.user_id IS NOT NULL THEN 'tenant' ELSE 'owner' END,
         CASE WHEN p_billed_to = 'tenant' THEN tn.user_id END,
         auth.uid(), TRUE
  FROM jsonb_array_elements(p_rows) r
  JOIN units u ON u.id = (r->>'unit_id')::uuid
  LEFT JOIN LATERAL (
    SELECT m.user_id FROM memberships m
    WHERE m.unit_id = u.id AND m.tenure = 'tenant' AND m.ended_at IS NULL
    ORDER BY m.created_at DESC LIMIT 1
  ) tn ON TRUE;

  UPDATE payment_request_lines l SET cancelled_at = now()
    FROM payment_requests r
   WHERE r.id = l.request_id AND r.special_charge_id = p_id AND l.cancelled_at IS NULL;

  IF p_request THEN
    v_days := COALESCE(p_due_days, effective_due_days(v_ids[1]));
    UPDATE payment_request_lines l SET cancelled_at = now()
     WHERE l.cancelled_at IS NULL AND l.building_id = ANY(v_ids);
    INSERT INTO payment_requests (building_id, compound_id, label, due_date, special_charge_id, created_by)
    VALUES (v_sc.building_id, v_sc.compound_id, btrim(p_label), CURRENT_DATE + v_days, p_id, auth.uid())
    RETURNING id INTO v_req;
    INSERT INTO payment_request_lines (request_id, unit_id, building_id, party, tenant_id, amount_requested)
    SELECT v_req, c.unit_id, c.building_id,
           CASE WHEN c.billed_to = 'tenant' THEN 'tenant' ELSE 'owner' END,
           CASE WHEN c.billed_to = 'tenant' THEN c.tenant_id END,
           ask.v
    FROM charges c
    CROSS JOIN LATERAL (
      SELECT LEAST(c.amount_usd, GREATEST(0,
        -unit_party_balance(c.unit_id, CASE WHEN c.billed_to = 'tenant' THEN 'tenant' ELSE 'owner' END)
      )) AS v
    ) ask
    WHERE c.special_charge_id = p_id AND c.voided_at IS NULL AND ask.v > 0.005;
  END IF;

  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT DISTINCT m.user_id, c.building_id, 'special_charge_updated',
         'Contribution updated', btrim(p_label) || ' — check your statement for the new amount.'
  FROM charges c
  JOIN memberships m ON m.unit_id = c.unit_id AND m.ended_at IS NULL
  WHERE c.special_charge_id = p_id AND c.voided_at IS NULL
    AND ((c.billed_to = 'tenant' AND m.tenure = 'tenant'
            AND (c.tenant_id IS NULL OR m.user_id = c.tenant_id))
      OR (c.billed_to <> 'tenant' AND m.tenure = 'owner'));
END;
$$;
GRANT EXECUTE ON FUNCTION update_special_charge(UUID, TEXT, JSONB, TEXT, TEXT, BOOLEAN, INT) TO authenticated;

CREATE OR REPLACE FUNCTION void_special_charge(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sc special_charges;
BEGIN
  SELECT * INTO v_sc FROM special_charges WHERE id = p_id FOR UPDATE;
  IF v_sc.id IS NULL THEN RAISE EXCEPTION 'Contribution not found.' USING ERRCODE = '22023'; END IF;
  IF NOT (is_platform_admin()
    OR (v_sc.building_id IS NOT NULL AND user_can(v_sc.building_id, 'charge.manage'))
    OR (v_sc.compound_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM buildings b WHERE b.compound_id = v_sc.compound_id
            AND user_can(b.id, 'charge.manage')))) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  IF v_sc.voided_at IS NOT NULL THEN RETURN; END IF;

  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT DISTINCT m.user_id, c.building_id, 'special_charge_voided',
         'Contribution removed', v_sc.label || ' — it no longer appears on your statement.'
  FROM charges c
  JOIN memberships m ON m.unit_id = c.unit_id AND m.ended_at IS NULL
  WHERE c.special_charge_id = p_id AND c.voided_at IS NULL
    AND ((c.billed_to = 'tenant' AND m.tenure = 'tenant'
            AND (c.tenant_id IS NULL OR m.user_id = c.tenant_id))
      OR (c.billed_to <> 'tenant' AND m.tenure = 'owner'));

  UPDATE charges SET voided_at = now(), voided_by = auth.uid(), void_reason = 'Contribution voided'
   WHERE special_charge_id = p_id AND voided_at IS NULL;
  UPDATE payment_request_lines l SET cancelled_at = now()
    FROM payment_requests r
   WHERE r.id = l.request_id AND r.special_charge_id = p_id AND l.cancelled_at IS NULL;
  UPDATE special_charges SET voided_at = now(), voided_by = auth.uid() WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION void_special_charge(UUID) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   1. Void an expense: it and its charges show voided, unit balances snap
--      back, cash on hand RISES by its amount, its extraordinary ask (if
--      any) stops chasing, billed residents get one 'Charges removed' bell.
--   2. Void a metered expense → refused with the Metering message.
--   3. fund_position: identical numbers to before for scopes with no voided
--      expenses (only the voided filter was added).
--   4. Contribution notices now read 'Contribution updated/removed'.
-- ============================================================
