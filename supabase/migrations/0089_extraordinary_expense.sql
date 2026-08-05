-- ============================================================
-- 0089_extraordinary_expense.sql
-- Urgent one-off expenses (expert session, 2026-08-05).
--
-- An extraordinary expense is money the building needs back NOW — a burst pipe,
-- an emergency generator repair. Flagging it collects it immediately instead of
-- waiting for the next cycle, and the ask says "extraordinary":
--
--   ARREARS building → a TARGETED payment request for exactly this expense's
--     charges, per party, labelled "Extraordinary: …". It deliberately does NOT
--     supersede the open general request: the general one predates this expense,
--     so their amounts never overlap — and the next general request supersedes
--     both and re-includes everything, which keeps the invariant that only the
--     latest general snapshot plus targeted asks issued after it are live.
--
--   DUES building → the client issues a FLAT one-line budget instead (true-up
--     off), because a ledger request in a prepay building finds nobody (0081).
--     The charge sits on the ledger AND the due asks the same money, and that
--     is exactly the shape the netting rule handles: the outstanding due
--     absorbs the ledger arrears, so the next trued-up budget cannot collect it
--     twice, while one payment settles both sides at once.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_extraordinary BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN expenses.is_extraordinary IS
  'Urgent one-off: collection was triggered immediately when it was entered (payment request in arrears, flat budget in dues mode).';

DROP FUNCTION IF EXISTS request_payment_for_expense(UUID, INT);
CREATE FUNCTION request_payment_for_expense(p_expense UUID, p_due_days INT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_exp   RECORD;
  v_ids   UUID[];
  v_req   UUID;
  v_days  INT;
BEGIN
  SELECT e.*, COALESCE(e.building_id, (SELECT (array_agg(b.id))[1] FROM buildings b WHERE b.compound_id = e.compound_id)) AS any_building
    INTO v_exp FROM expenses e WHERE e.id = p_expense;
  IF v_exp IS NULL THEN
    RAISE EXCEPTION 'Expense not found.' USING ERRCODE = '22023';
  END IF;

  -- the buildings this expense actually charged
  SELECT array_agg(DISTINCT c.building_id) INTO v_ids FROM charges c WHERE c.expense_id = p_expense;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'This expense has no charges to collect.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM unnest(v_ids) id
                  WHERE is_platform_admin() OR user_can(id, 'charge.manage')) THEN
    RAISE EXCEPTION 'Not allowed to request payment here.' USING ERRCODE = '42501';
  END IF;

  -- dues buildings collect this through a flat budget, not a ledger request
  IF EXISTS (SELECT 1 FROM unnest(v_ids) id WHERE effective_billing_mode(id) = 'dues') THEN
    RAISE EXCEPTION 'This building bills by dues. The extraordinary ask is issued as a flat budget instead.'
      USING ERRCODE = 'P0001';
  END IF;

  v_days := COALESCE(p_due_days, effective_due_days(v_ids[1]));

  -- targeted: no superseding — see header
  INSERT INTO payment_requests (building_id, compound_id, label, due_date, created_by)
  VALUES (v_exp.building_id, v_exp.compound_id,
          'Extraordinary: ' || v_exp.description,
          CURRENT_DATE + v_days, auth.uid())
  RETURNING id INTO v_req;

  -- one line per charge: exactly this expense's money, per party
  INSERT INTO payment_request_lines (request_id, unit_id, building_id, party, tenant_id, amount_requested)
  SELECT v_req, c.unit_id, c.building_id,
         CASE WHEN c.billed_to = 'tenant' THEN 'tenant' ELSE 'owner' END,
         CASE WHEN c.billed_to = 'tenant' THEN c.tenant_id END,
         c.amount_usd
  FROM charges c
  WHERE c.expense_id = p_expense AND c.voided_at IS NULL AND c.amount_usd > 0;

  RETURN v_req;
END;
$$;
GRANT EXECUTE ON FUNCTION request_payment_for_expense(UUID, INT) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   Flag an expense extraordinary in an ARREARS building → a request labelled
--   "Extraordinary: …" appears with one line per charged party, the open
--   general request untouched; get_overdue_units returns ONE row per
--   unit+party summing both (0088 aggregation), labelled "… +1".
-- ============================================================
