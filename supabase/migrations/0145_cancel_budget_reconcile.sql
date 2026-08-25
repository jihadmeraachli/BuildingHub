-- ============================================================
-- 0145_cancel_budget_reconcile.sql
-- DUES audit D9 (Ahmad-approved, my recommended resolution): cancelling a
-- budget was one-sided.
--   · It deleted the dues but left any payments made against them → the unit
--     ends up in silent credit (surfaced to the manager client-side now, D9 UI).
--   · It fired a "dues removed" storm to every affected resident — housekeeping,
--     not news.
--   · For an EXTRAORDINARY budget it deleted the offsetting due but left the
--     paired ledger CHARGE (0089), so the unit still owed the money with no
--     dues record to net it.
--
-- FIX: before deleting the dues, mark them notify_suppressed (0144) so the
-- cancel goes quiet; and if the budget carries an expense (only extraordinary
-- budgets do — issue_budget sets budgets.expense_id), delete that expense so its
-- charges cascade away (expenses→charges is ON DELETE CASCADE, 0002), keeping
-- the ledger consistent. Payments are intentionally kept: they become a visible
-- credit the manager was warned about, not silently destroyed.
--
-- Body is 0092's cancel_budget + these three lines. Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION cancel_budget(p_budget UUID)
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

  -- 0145 (D9): silence the resident "dues removed" storm on a manager cancel.
  UPDATE dues SET notify_suppressed = TRUE WHERE budget_id = p_budget AND notify_suppressed = FALSE;
  DELETE FROM dues WHERE budget_id = p_budget;

  -- 0145 (D9): void the paired charge for an extraordinary budget so the ledger
  -- doesn't keep charging money the cancelled dues were meant to offset. Only
  -- extraordinary budgets carry an expense_id; recurring budgets leave it NULL.
  IF v_b.expense_id IS NOT NULL THEN
    DELETE FROM expenses WHERE id = v_b.expense_id;   -- charges cascade (0002)
  END IF;

  UPDATE budgets SET cancelled_at = now() WHERE id = p_budget;
END;
$$;
GRANT EXECUTE ON FUNCTION cancel_budget(UUID) TO authenticated;

COMMIT;

-- Post-run checks:
--   Cancel a recurring budget with a paid due → dues gone, NO resident email,
--     the payment remains as a visible unit credit (manager was warned client-side).
--   Cancel an extraordinary budget ($500 charge + $500 due) → both the due and
--     the ledger charge disappear; the unit no longer owes the $500.
--   Cancel a budget with no expense_id → charges untouched (nothing to void).
