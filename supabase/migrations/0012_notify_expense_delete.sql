-- ============================================================
-- BuildingHub — notify unit owners when an EXPENSE is deleted
-- (its charges cascade away). Must run BEFORE the cascade so the
-- charges still exist to resolve the affected owners. Safe to re-run.
--
-- Note: expense CREATE and EDIT already notify owners via the charge
-- INSERT trigger (edit re-allocates → fresh "New charge"). Only DELETE
-- was silent. Email isn't added for this case: by the time a webhook
-- fires (post-commit) the charge rows are already gone, so recipients
-- can't be resolved — the in-app trigger below is the reliable path.
-- ============================================================

CREATE OR REPLACE FUNCTION notify_on_expense_delete() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT DISTINCT m.user_id, OLD.building_id, 'charge_removed',
         'Charge removed',
         'A charge for "' || COALESCE(OLD.description, 'an expense') || '" was removed from your account'
  FROM charges c
  JOIN memberships m ON m.unit_id = c.unit_id
  WHERE c.expense_id = OLD.id;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_notify_expense_delete ON expenses;
CREATE TRIGGER trg_notify_expense_delete BEFORE DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION notify_on_expense_delete();
