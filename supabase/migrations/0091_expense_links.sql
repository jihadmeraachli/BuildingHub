-- ============================================================
-- 0091_expense_links.sql
-- Plugs the loopholes the money audit found (2026-08-05, follow-up to 0089).
--
-- 1. DELETING AN EXTRAORDINARY EXPENSE LEFT ITS ASK ALIVE. The expense and its
--    charges cascade away, but the payment request (arrears) or the flat
--    budget + dues (dues mode) it auto-issued had no link back — residents
--    kept being reminded to pay for something that no longer exists, forever,
--    with nothing on screen to explain it. The ask now carries expense_id with
--    ON DELETE CASCADE: deleting the expense deletes the ask.
--
-- 2. DELETING A BUDGET ORPHANED ITS DUES. dues.budget_id is ON DELETE SET
--    NULL (0087), so a cascaded budget delete would leave the dues rows live
--    and chased, now belonging to nothing. A BEFORE DELETE trigger removes the
--    budget's dues first — which also fires the dues-removed notifications, so
--    residents hear that the ask was withdrawn. The same trigger serves the
--    new Cancel-budget action in the app (which soft-cancels the budget row
--    for audit and deletes its dues the same way).
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS expense_id UUID REFERENCES expenses(id) ON DELETE CASCADE;
ALTER TABLE budgets          ADD COLUMN IF NOT EXISTS expense_id UUID REFERENCES expenses(id) ON DELETE CASCADE;
COMMENT ON COLUMN payment_requests.expense_id IS
  'Set when the request was auto-issued by an extraordinary expense (0089). Deleting the expense deletes the ask.';
COMMENT ON COLUMN budgets.expense_id IS
  'Set when the budget was auto-issued by an extraordinary expense in dues mode (0089). Deleting the expense deletes the ask.';

-- a deleted budget takes its dues with it (BEFORE, so the FK has not yet
-- nulled dues.budget_id) — the dues DELETE triggers notify the billed parties
CREATE OR REPLACE FUNCTION trg_budget_delete_dues() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM dues WHERE budget_id = OLD.id;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS budget_delete_dues ON budgets;
CREATE TRIGGER budget_delete_dues BEFORE DELETE ON budgets
  FOR EACH ROW EXECUTE FUNCTION trg_budget_delete_dues();

-- the extraordinary request now records which expense issued it
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

  INSERT INTO payment_requests (building_id, compound_id, label, due_date, expense_id, created_by)
  VALUES (v_exp.building_id, v_exp.compound_id,
          'Extraordinary: ' || v_exp.description,
          CURRENT_DATE + v_days, p_expense, auth.uid())
  RETURNING id INTO v_req;

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
--   Extraordinary expense in ARREARS → delete the expense → its request and
--   lines are gone; get_overdue_units stops returning them the same moment.
--   Extraordinary expense in DUES mode (the client stamps budgets.expense_id)
--   → delete the expense → the budget cascades, the trigger deletes its dues,
--   residents get the dues-removed notification.
--   Cancel a budget in the app → budget row stays (cancelled_at set, audit),
--   its dues are gone, reminders stop.
-- ============================================================
