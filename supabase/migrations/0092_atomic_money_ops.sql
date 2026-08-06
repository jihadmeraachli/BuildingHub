-- ============================================================
-- 0092_atomic_money_ops.sql
-- Money operations become single transactions (Jihad's Claude's review,
-- 2026-08-06 — the claims were right, and one was understated).
--
-- THE PROBLEM. Three flows ran as multiple client calls from a phone on a
-- Lebanese connection, each able to half-complete:
--
--   cancel budget   delete dues → mark cancelled        (2 calls)
--   delete cycle    delete expense → delete cycle        (2 calls)
--   re-post cycle   update expense → delete charges → insert charges (3 calls!)
--
-- The re-post is the worst and the review missed it: fail between the last two
-- and the charges are GONE while the expense still claims the money — the book
-- and the expense list disagree until someone notices. All three become
-- SECURITY DEFINER functions: one round trip, one transaction, all-or-nothing.
--
-- ALSO: the metered-expense edit guard moves into the database. The UI block
-- (0091) stopped the Expenses tab, but nothing stopped a raw UPDATE — and
-- CLAUDE.md's own rule is that integrity lives in the database. A trigger now
-- rejects changes to a metered expense's money fields unless the update comes
-- through repost_metered_expense(), which marks the transaction with a local
-- setting. Deletes stay allowed (they cascade consistently by design).
--
-- And the 0085 nit: expenses_type_idx actually sits on expense_types — renamed.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Cancel a budget: withdraw its dues and mark it, atomically.
--    The dues DELETE fires the dues-removed notifications as before.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS cancel_budget(UUID);
CREATE FUNCTION cancel_budget(p_budget UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_b RECORD;
BEGIN
  SELECT * INTO v_b FROM budgets WHERE id = p_budget AND cancelled_at IS NULL;
  IF v_b IS NULL THEN
    RAISE EXCEPTION 'Budget not found or already cancelled.' USING ERRCODE = '22023';
  END IF;
  IF NOT (is_platform_admin()
          OR (v_b.building_id IS NOT NULL AND user_can(v_b.building_id, 'charge.manage'))
          OR (v_b.compound_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM buildings b WHERE b.compound_id = v_b.compound_id AND user_can(b.id, 'charge.manage')))) THEN
    RAISE EXCEPTION 'Not allowed to cancel this budget.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM dues WHERE budget_id = p_budget;
  UPDATE budgets SET cancelled_at = now() WHERE id = p_budget;
END;
$$;
GRANT EXECUTE ON FUNCTION cancel_budget(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 2. Delete a metering cycle with its posted expense, atomically.
--    (Charges cascade from the expense; readings cascade from the cycle.)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS delete_meter_cycle(UUID);
CREATE FUNCTION delete_meter_cycle(p_cycle UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_c RECORD;
BEGIN
  SELECT * INTO v_c FROM meter_cycles WHERE id = p_cycle;
  IF v_c IS NULL THEN
    RAISE EXCEPTION 'Cycle not found.' USING ERRCODE = '22023';
  END IF;
  IF NOT (is_platform_admin()
          OR (v_c.building_id IS NOT NULL AND user_can(v_c.building_id, 'expense.manage'))
          OR (v_c.compound_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM buildings b WHERE b.compound_id = v_c.compound_id AND user_can(b.id, 'expense.manage')))) THEN
    RAISE EXCEPTION 'Not allowed to delete this cycle.' USING ERRCODE = '42501';
  END IF;

  IF v_c.expense_id IS NOT NULL THEN
    DELETE FROM expenses WHERE id = v_c.expense_id;
  END IF;
  DELETE FROM meter_cycles WHERE id = p_cycle;
END;
$$;
GRANT EXECUTE ON FUNCTION delete_meter_cycle(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 3. Re-post a metered expense: update + rebuild charges in ONE transaction.
--    Marks the transaction so the guard trigger (below) lets it through.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS repost_metered_expense(UUID, JSONB, JSONB);
CREATE FUNCTION repost_metered_expense(p_expense UUID, p_fields JSONB, p_charges JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_e RECORD;
BEGIN
  SELECT * INTO v_e FROM expenses WHERE id = p_expense AND meter_cycle_id IS NOT NULL;
  IF v_e IS NULL THEN
    RAISE EXCEPTION 'Metered expense not found.' USING ERRCODE = '22023';
  END IF;
  IF NOT (is_platform_admin()
          OR (v_e.building_id IS NOT NULL AND user_can(v_e.building_id, 'expense.manage'))
          OR (v_e.compound_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM buildings b WHERE b.compound_id = v_e.compound_id AND user_can(b.id, 'expense.manage')))) THEN
    RAISE EXCEPTION 'Not allowed to re-post this expense.' USING ERRCODE = '42501';
  END IF;

  -- transaction-local flag: the guard trigger admits THIS update only
  PERFORM set_config('app.metering_repost', '1', true);

  UPDATE expenses SET
    category        = COALESCE(p_fields->>'category', category),
    expense_type_id = NULLIF(p_fields->>'expense_type_id', '')::UUID,
    description     = COALESCE(p_fields->>'description', description),
    amount_usd      = (p_fields->>'amount_usd')::NUMERIC,
    amount_lbp      = NULLIF(p_fields->>'amount_lbp', '')::NUMERIC,
    lbp_rate        = NULLIF(p_fields->>'lbp_rate', '')::NUMERIC,
    expense_date    = (p_fields->>'expense_date')::DATE
  WHERE id = p_expense;

  DELETE FROM charges WHERE expense_id = p_expense;

  INSERT INTO charges (expense_id, unit_id, building_id, category, description, amount_usd, charge_date, billed_to, tenant_id, created_by)
  SELECT p_expense,
         (c->>'unit_id')::UUID,
         (c->>'building_id')::UUID,
         c->>'category',
         c->>'description',
         (c->>'amount_usd')::NUMERIC,
         (c->>'charge_date')::DATE,
         c->>'billed_to',
         NULLIF(c->>'tenant_id', '')::UUID,
         auth.uid()
  FROM jsonb_array_elements(p_charges) AS c;
END;
$$;
GRANT EXECUTE ON FUNCTION repost_metered_expense(UUID, JSONB, JSONB) TO authenticated;

-- ------------------------------------------------------------
-- 4. The guard, in the database this time: a metered expense's money fields
--    only change through the function above. Deletes stay allowed — they
--    cascade consistently (0090/0091) and the Expenses-tab confirm explains.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_guard_metered_expense() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.meter_cycle_id IS NOT NULL
     AND current_setting('app.metering_repost', true) IS DISTINCT FROM '1'
     AND (NEW.amount_usd      IS DISTINCT FROM OLD.amount_usd
       OR NEW.amount_lbp      IS DISTINCT FROM OLD.amount_lbp
       OR NEW.lbp_rate        IS DISTINCT FROM OLD.lbp_rate
       OR NEW.expense_date    IS DISTINCT FROM OLD.expense_date
       OR NEW.category        IS DISTINCT FROM OLD.category
       OR NEW.expense_type_id IS DISTINCT FROM OLD.expense_type_id
       OR NEW.meter_cycle_id  IS DISTINCT FROM OLD.meter_cycle_id) THEN
    RAISE EXCEPTION 'This expense was posted by a metering cycle — edit the cycle, which recomputes and re-posts.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_metered_expense ON expenses;
CREATE TRIGGER guard_metered_expense BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION trg_guard_metered_expense();

-- 5. the 0085 nit: the index sits on expense_types, name said expenses
ALTER INDEX IF EXISTS expenses_type_idx RENAME TO expense_types_scope_idx;

COMMIT;

-- ============================================================
-- Post-run checks:
--   UPDATE expenses SET amount_usd = 999 WHERE meter_cycle_id IS NOT NULL;
--     → 'This expense was posted by a metering cycle…'
--   Edit a cycle in the app → recompute & re-post succeeds (one transaction).
--   Cancel a budget / delete a cycle mid-flight (kill the connection):
--     → either everything happened or nothing did.
-- ============================================================
