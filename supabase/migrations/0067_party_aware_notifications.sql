-- ============================================================
-- 0067_party_aware_notifications.sql
-- In-app 🔔 notifications must follow the money's party:
--   · charge billed_to = 'tenant'  → notify the tenant only
--   · charge billed_to = 'owner'/'both' (legacy = owner) → notify the owner only
--   · payment paid_by  = 'tenant'  → notify the tenant only
--   · payment paid_by  = 'owner'   → notify the owner only
--   · move-out offload (transfer_in/out) → notify BOTH owner + the former tenant
-- Previously every charge/payment fanned out to EVERY membership of the unit
-- (owner AND tenant), which is finance feedback #9.
--
-- When a row carries tenant_id (0066) we target that exact tenant; otherwise we
-- fall back to the unit's active tenant membership(s). Only ACTIVE memberships
-- (ended_at IS NULL) receive charge/payment notices — a moved-out tenant never
-- gets billed again. The offload notice is the one exception: it reaches the
-- former tenant by tenant_id even though their membership has ended.
--
-- Additive & idempotent. Transactional.
-- ============================================================
BEGIN;

-- no type CHECK constraint on notifications (0009 dropped it) — keep it dropped
-- so 'balance_transferred' is accepted.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

-- ---- charge issued -> the billed party only ----
CREATE OR REPLACE FUNCTION notify_on_charge() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT m.user_id, NEW.building_id, 'charge_issued',
         'New charge', COALESCE(NEW.description, 'Charge') || ' — $' || NEW.amount_usd
  FROM memberships m
  WHERE m.unit_id = NEW.unit_id AND m.ended_at IS NULL
    AND (
      (NEW.billed_to = 'tenant' AND m.tenure = 'tenant'
         AND (NEW.tenant_id IS NULL OR m.user_id = NEW.tenant_id))
      OR (NEW.billed_to <> 'tenant' AND m.tenure = 'owner')
    );
  RETURN NEW;
END; $$;

-- ---- payment recorded -> the paying party only ----
CREATE OR REPLACE FUNCTION notify_on_payment() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT m.user_id, NEW.building_id, 'payment_received',
         'Payment recorded', '$' || NEW.amount_usd || ' received — thank you'
  FROM memberships m
  WHERE m.unit_id = NEW.unit_id AND m.ended_at IS NULL
    AND (
      (NEW.paid_by = 'tenant' AND m.tenure = 'tenant'
         AND (NEW.tenant_id IS NULL OR m.user_id = NEW.tenant_id))
      OR (NEW.paid_by <> 'tenant' AND m.tenure = 'owner')
    );
  RETURN NEW;
END; $$;

-- ---- payment edited (amount changed) -> the paying party only ----
CREATE OR REPLACE FUNCTION notify_on_payment_update() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.amount_usd IS DISTINCT FROM OLD.amount_usd THEN
    INSERT INTO notifications (user_id, building_id, type, title, body)
    SELECT m.user_id, NEW.building_id, 'payment_updated',
           'Payment updated', 'Your payment was updated to $' || NEW.amount_usd
    FROM memberships m
    WHERE m.unit_id = NEW.unit_id AND m.ended_at IS NULL
      AND (
        (NEW.paid_by = 'tenant' AND m.tenure = 'tenant'
           AND (NEW.tenant_id IS NULL OR m.user_id = NEW.tenant_id))
        OR (NEW.paid_by <> 'tenant' AND m.tenure = 'owner')
      );
  END IF;
  RETURN NEW;
END; $$;

-- ---- payment deleted -> the paying party only ----
CREATE OR REPLACE FUNCTION notify_on_payment_delete() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT m.user_id, OLD.building_id, 'payment_removed',
         'Payment removed', 'A payment of $' || OLD.amount_usd || ' was removed from your account'
  FROM memberships m
  WHERE m.unit_id = OLD.unit_id AND m.ended_at IS NULL
    AND (
      (OLD.paid_by = 'tenant' AND m.tenure = 'tenant'
         AND (OLD.tenant_id IS NULL OR m.user_id = OLD.tenant_id))
      OR (OLD.paid_by <> 'tenant' AND m.tenure = 'owner')
    );
  RETURN OLD;
END; $$;

-- ---- move-out offload (transfer) -> BOTH owner + the former tenant ----
-- end_membership() inserts a PAIR of transfer rows (one tenant-party, one
-- owner-party). We drive the notification off the TENANT-party row only, so the
-- pair produces a single notice to each side (no duplicates).
CREATE OR REPLACE FUNCTION notify_on_adjustment() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.kind IN ('transfer_in', 'transfer_out') AND NEW.party = 'tenant' THEN
    -- owner(s) of the unit (active)
    INSERT INTO notifications (user_id, building_id, type, title, body)
    SELECT m.user_id, NEW.building_id, 'balance_transferred',
           'Balance transferred',
           'A former tenant''s balance of $' || NEW.amount_usd || ' was transferred to the owner account'
    FROM memberships m
    WHERE m.unit_id = NEW.unit_id AND m.ended_at IS NULL AND m.tenure = 'owner';

    -- the former tenant, by id (their membership is already ended)
    IF NEW.tenant_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, building_id, type, title, body)
      VALUES (NEW.tenant_id, NEW.building_id, 'balance_transferred',
              'Balance transferred',
              'Your remaining balance of $' || NEW.amount_usd || ' was transferred to the unit owner on move-out');
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_adjustment ON adjustments;
CREATE TRIGGER trg_notify_adjustment AFTER INSERT ON adjustments FOR EACH ROW EXECUTE FUNCTION notify_on_adjustment();

COMMIT;
