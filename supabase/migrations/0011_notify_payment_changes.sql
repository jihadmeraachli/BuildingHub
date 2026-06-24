-- ============================================================
-- BuildingHub — notify unit owners when a payment is EDITED or DELETED
-- (insert is already covered). In-app via triggers; safe to re-run.
-- Note: we intentionally do NOT add charge edit/delete triggers — editing
-- an expense re-allocates (delete+insert) its charges, which would spam.
-- ============================================================

-- payment edited (only when the amount actually changes) -> owners
CREATE OR REPLACE FUNCTION notify_on_payment_update() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.amount_usd IS DISTINCT FROM OLD.amount_usd THEN
    INSERT INTO notifications (user_id, building_id, type, title, body)
    SELECT m.user_id, NEW.building_id, 'payment_updated',
           'Payment updated', 'Your payment was updated to $' || NEW.amount_usd
    FROM memberships m WHERE m.unit_id = NEW.unit_id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_payment_update ON payments;
CREATE TRIGGER trg_notify_payment_update AFTER UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION notify_on_payment_update();

-- payment deleted -> owners
CREATE OR REPLACE FUNCTION notify_on_payment_delete() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT m.user_id, OLD.building_id, 'payment_removed',
         'Payment removed', 'A payment of $' || OLD.amount_usd || ' was removed from your account'
  FROM memberships m WHERE m.unit_id = OLD.unit_id;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_payment_delete ON payments;
CREATE TRIGGER trg_notify_payment_delete AFTER DELETE ON payments FOR EACH ROW EXECUTE FUNCTION notify_on_payment_delete();
