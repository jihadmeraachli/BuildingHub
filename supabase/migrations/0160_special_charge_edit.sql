-- ============================================================
-- 0160_special_charge_edit.sql
-- Special charges become editable; every change tells the residents
-- (Jey's QA round 3, 2026-08-29).
--
-- EDIT = REPLACE, AUDITED. update_special_charge() voids the current
-- charge rows (reason 'Special charge edited' - the trail survives),
-- writes the new allocation with notify_suppressed = TRUE (no per-charge
-- bell storm; 0121's flag, honored by notify_on_charge), cancels the old
-- request lines, and optionally issues a fresh NETTED request. THE NOTICE
-- RULE: when a request is (re)issued, the request's own notification goes
-- out on every channel; with no request, residents still get ONE in-app
-- notice of the edit. Voiding now sends the same in-app notice.
--
-- EXTRAORDINARY PARITY: request_payment_for_expense() (restated from 0158)
-- now first cancels ITS OWN expense's live request lines, so editing an
-- extraordinary expense and re-requesting replaces the ask instead of
-- stacking a second one. The client re-issues it on every edit of an
-- extraordinary expense - amounts stay honest, the notification goes out.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;
SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------------------
-- 1. Edit door.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_special_charge(
  p_id        UUID,
  p_label     TEXT,
  p_rows      JSONB,           -- [{unit_id, amount}]
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
  IF v_sc.id IS NULL THEN RAISE EXCEPTION 'Special charge not found.' USING ERRCODE = '22023'; END IF;
  IF v_sc.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'This special charge was voided - issue a new one instead.' USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION 'The special charge needs a label.' USING ERRCODE = '22023';
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

  -- replace, audited: old rows voided, new rows quiet (one notice below)
  UPDATE charges SET voided_at = now(), voided_by = auth.uid(), void_reason = 'Special charge edited'
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

  -- the old ask dies with the old rows
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

  -- one in-app notice per affected person, always
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT DISTINCT m.user_id, c.building_id, 'special_charge_updated',
         'Special charge updated', btrim(p_label) || ' — check your statement for the new amount.'
  FROM charges c
  JOIN memberships m ON m.unit_id = c.unit_id AND m.ended_at IS NULL
  WHERE c.special_charge_id = p_id AND c.voided_at IS NULL
    AND ((c.billed_to = 'tenant' AND m.tenure = 'tenant'
            AND (c.tenant_id IS NULL OR m.user_id = c.tenant_id))
      OR (c.billed_to <> 'tenant' AND m.tenure = 'owner'));
END;
$$;
GRANT EXECUTE ON FUNCTION update_special_charge(UUID, TEXT, JSONB, TEXT, TEXT, BOOLEAN, INT) TO authenticated;

-- ------------------------------------------------------------
-- 2. Voiding tells the residents too (0158 verbatim + the notice,
--    captured BEFORE the rows are voided).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION void_special_charge(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sc special_charges;
BEGIN
  SELECT * INTO v_sc FROM special_charges WHERE id = p_id FOR UPDATE;
  IF v_sc.id IS NULL THEN RAISE EXCEPTION 'Special charge not found.' USING ERRCODE = '22023'; END IF;
  IF NOT (is_platform_admin()
    OR (v_sc.building_id IS NOT NULL AND user_can(v_sc.building_id, 'charge.manage'))
    OR (v_sc.compound_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM buildings b WHERE b.compound_id = v_sc.compound_id
            AND user_can(b.id, 'charge.manage')))) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  IF v_sc.voided_at IS NOT NULL THEN RETURN; END IF;

  -- notice first (targets come from the still-live rows)
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT DISTINCT m.user_id, c.building_id, 'special_charge_voided',
         'Special charge removed', v_sc.label || ' — it no longer appears on your statement.'
  FROM charges c
  JOIN memberships m ON m.unit_id = c.unit_id AND m.ended_at IS NULL
  WHERE c.special_charge_id = p_id AND c.voided_at IS NULL
    AND ((c.billed_to = 'tenant' AND m.tenure = 'tenant'
            AND (c.tenant_id IS NULL OR m.user_id = c.tenant_id))
      OR (c.billed_to <> 'tenant' AND m.tenure = 'owner'));

  UPDATE charges SET voided_at = now(), voided_by = auth.uid(), void_reason = 'Special charge voided'
   WHERE special_charge_id = p_id AND voided_at IS NULL;
  UPDATE payment_request_lines l SET cancelled_at = now()
    FROM payment_requests r
   WHERE r.id = l.request_id AND r.special_charge_id = p_id AND l.cancelled_at IS NULL;
  UPDATE special_charges SET voided_at = now(), voided_by = auth.uid() WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION void_special_charge(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 3. Extraordinary parity: re-requesting an expense REPLACES its own
--    previous ask (0158 verbatim + the self-cancel).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_payment_for_expense(p_expense UUID, p_due_days INT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_exp   RECORD;
  v_ids   UUID[];
  v_req   UUID;
  v_days  INT;
BEGIN
  SELECT e.* INTO v_exp FROM expenses e WHERE e.id = p_expense;
  IF v_exp IS NULL THEN
    RAISE EXCEPTION 'Expense not found.' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT c.building_id) INTO v_ids FROM charges c WHERE c.expense_id = p_expense;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'This expense has no charges to collect.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM unnest(v_ids) id
                  WHERE is_platform_admin() OR user_can(id, 'charge.manage')) THEN
    RAISE EXCEPTION 'Not allowed to request payment here.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(v_ids) id WHERE effective_billing_mode(id) = 'dues') THEN
    RAISE EXCEPTION 'This building bills by dues. The extraordinary ask is issued as a flat budget instead.'
      USING ERRCODE = 'P0001';
  END IF;

  v_days := COALESCE(p_due_days, effective_due_days(v_ids[1]));

  -- 0160: replace this expense's own previous ask instead of stacking one
  UPDATE payment_request_lines l SET cancelled_at = now()
    FROM payment_requests r
   WHERE r.id = l.request_id AND r.expense_id = p_expense AND l.cancelled_at IS NULL;

  INSERT INTO payment_requests (building_id, compound_id, label, due_date, expense_id, created_by)
  VALUES (v_exp.building_id, v_exp.compound_id,
          'Extraordinary: ' || v_exp.description,
          CURRENT_DATE + v_days, p_expense, auth.uid())
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
  WHERE c.expense_id = p_expense AND c.voided_at IS NULL AND ask.v > 0.005;

  RETURN v_req;
END;
$$;
GRANT EXECUTE ON FUNCTION request_payment_for_expense(UUID, INT) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   1. Edit a special charge: old charges show voided ('Special charge
--      edited'), new amounts land quietly, affected residents get ONE
--      'Special charge updated' bell; with the request box ticked they get
--      the request notification instead of just the bell.
--   2. Void: residents get 'Special charge removed'; balances snap back.
--   3. Edit an extraordinary expense: its ask is REPLACED (old lines
--      cancelled, one new netted request) - never two asks for one expense.
-- ============================================================
