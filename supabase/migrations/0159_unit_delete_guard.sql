-- ============================================================
-- 0159_unit_delete_guard.sql
-- A unit leaves only with a settled book (Jey's QA, 2026-08-29).
--
-- TWO RULES.
--
-- 1. DELETING (trashing) a unit requires balance EXACTLY zero - not
--    positive, not negative. An admin must settle or void the money first;
--    the error names the amount. The check runs in a BEFORE DELETE trigger
--    named to sort BEFORE soft_delete_trg (BEFORE-trigger order is by name,
--    0138), so it fires before the soft-delete conversion swallows the
--    delete. The balance math mirrors unit_balance_asof (0043) INLINE -
--    the viewer gate can't be used here because the purge cron has no auth
--    context.
--
-- 2. FINANCIAL HISTORY IS NEVER CASCADE-DELETED. The FKs say ON DELETE
--    CASCADE (0002), so a hard PURGE of a unit would take its charges,
--    payments and adjustments with it. The guard cancels the purge
--    SILENTLY (RETURN NULL) whenever such rows exist: the unit stays in
--    the trash as an archive forever, purge_soft_deleted() (0138) skips it
--    without erroring, and the ledgers keep their past. Only a unit with
--    no financial rows can ever be purged.
--
-- Plus deleted_unit_labels(): Finance tabs show a deleted unit's charges
-- and payments tagged with its (hidden-by-RLS) label instead of a dash.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION units_delete_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bal NUMERIC;
  v_has_history BOOLEAN;
BEGIN
  -- the unit's balance today - unit_balance_asof's formula (0043), inlined
  -- so it also works for the auth-less purge cron
  SELECT ROUND(
      COALESCE((SELECT u.opening_balance FROM units u
                 WHERE u.id = OLD.id
                   AND (u.opening_balance_date IS NULL OR u.opening_balance_date <= CURRENT_DATE)), 0)
    + COALESCE((SELECT SUM(p.amount_usd) FROM payments p
                 WHERE p.unit_id = OLD.id AND p.voided_at IS NULL AND p.paid_on     <= CURRENT_DATE), 0)
    - COALESCE((SELECT SUM(c.amount_usd) FROM charges c
                 WHERE c.unit_id = OLD.id AND c.voided_at IS NULL AND c.charge_date <= CURRENT_DATE), 0)
    + COALESCE((SELECT SUM(adjustment_effect(a.kind, a.amount_usd)) FROM adjustments a
                 WHERE a.unit_id = OLD.id AND a.voided_at IS NULL AND a.effective_date <= CURRENT_DATE), 0)
  , 2) INTO v_bal;

  IF OLD.deleted_at IS NULL THEN
    -- trashing: the book must be settled first (user-facing error)
    IF v_bal <> 0 THEN
      RAISE EXCEPTION 'This unit still has a balance of $% — bring it to exactly zero (settle or void) before deleting.', v_bal
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;  -- soft_delete_trg converts this into a trash move
  END IF;

  -- purge attempt: history is never cascade-deleted. Cancel silently so the
  -- unit stays archived in the trash and the purge cron skips it, no error.
  SELECT EXISTS (SELECT 1 FROM charges     c WHERE c.unit_id = OLD.id)
      OR EXISTS (SELECT 1 FROM payments    p WHERE p.unit_id = OLD.id)
      OR EXISTS (SELECT 1 FROM adjustments a WHERE a.unit_id = OLD.id)
    INTO v_has_history;
  IF v_has_history THEN
    RETURN NULL;
  END IF;
  RETURN OLD;
END;
$$;

-- 'aa_' sorts before 'soft_delete_trg', so the guard sees the delete first
DROP TRIGGER IF EXISTS aa_units_delete_guard_trg ON units;
CREATE TRIGGER aa_units_delete_guard_trg BEFORE DELETE ON units
  FOR EACH ROW EXECUTE FUNCTION units_delete_guard();

-- ------------------------------------------------------------
-- Deleted units' labels for the finance tabs: the RESTRICTIVE soft-delete
-- policy (0138) hides trashed rows from normal reads, so the tabs showed a
-- dash where a deleted unit's history sat. Managers get id -> label here.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION deleted_unit_labels(p_building_ids UUID[])
RETURNS TABLE(id UUID, label TEXT, building_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id, u.label, u.building_id
  FROM units u
  WHERE u.building_id = ANY(p_building_ids)
    AND u.deleted_at IS NOT NULL
    AND (is_platform_admin() OR user_can(u.building_id, 'finance.view'));
$$;
GRANT EXECUTE ON FUNCTION deleted_unit_labels(UUID[]) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   1. Delete a unit owing $50 → 'balance of $-50.00 … before deleting.'
--      Delete a unit in credit → refused too. Settle to 0 → trash works.
--   2. Trash a zero-balance unit WITH history → lands in trash; delete it
--      again (purge) → silently stays (0 rows affected); its charges and
--      payments remain. A unit with NO financial rows purges normally.
--   3. Finance > Charges/Payments: rows of a trashed unit show
--      "Label · deleted unit" instead of a dash.
--   4. purge_soft_deleted() runs clean with archived units in the trash.
-- ============================================================
