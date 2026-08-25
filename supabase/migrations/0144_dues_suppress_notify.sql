-- ============================================================
-- 0144_dues_suppress_notify.sql
-- DUES audit D10 (Ahmad-approved): the 30-day purge fires a "dues removed"
-- email/WhatsApp/in-app storm. When purge_soft_deleted() hard-deletes a
-- unit/building 30 days after it was trashed, its dues cascade-delete (0015)
-- and each one fires notify_on_dues_delete() + the DELETE Database Webhook —
-- so former residents get "your dues were removed" a month after they left.
--
-- FIX (the 0121 charges.notify_suppressed pattern, reused): give dues the same
-- suppression flag. The purge sets it TRUE on the affected dues BEFORE the
-- cascade, and both the in-app trigger and (in dynamic-action) the webhook skip
-- a suppressed row. Housekeeping deletes go quiet; a real manager cancel/edit
-- still notifies unless it too opts in (see 0145 cancel_budget).
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- 1. The suppression flag (mirrors charges.notify_suppressed, 0121).
ALTER TABLE dues ADD COLUMN IF NOT EXISTS notify_suppressed BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN dues.notify_suppressed IS
  'TRUE = a housekeeping write (purge cascade 0144, budget cancel 0145) — the delete/update notification (in-app trigger + dynamic-action webhook) is skipped. Mirrors charges.notify_suppressed (0121).';

-- 2. The in-app delete trigger skips a suppressed row.
CREATE OR REPLACE FUNCTION notify_on_dues_delete() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.notify_suppressed THEN RETURN OLD; END IF;   -- 0144: housekeeping, not resident news
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT m.user_id, OLD.building_id, 'dues_removed',
         'Dues removed', 'Your dues for ' || OLD.period_label || ' were removed'
  FROM memberships m
  WHERE m.unit_id = OLD.unit_id AND m.ended_at IS NULL
    AND (
      (OLD.billed_to = 'tenant' AND m.tenure = 'tenant'
         AND (OLD.tenant_id IS NULL OR m.user_id = OLD.tenant_id))
      OR (OLD.billed_to <> 'tenant' AND m.tenure = 'owner')
    );
  RETURN OLD;
END; $$;

-- 3. The in-app update trigger likewise skips a suppressed row (e.g. the purge's
--    own flag-setting UPDATE, and any suppressed housekeeping edit).
CREATE OR REPLACE FUNCTION notify_on_dues_update() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.notify_suppressed THEN RETURN NEW; END IF;   -- 0144
  IF NEW.amount_due IS DISTINCT FROM OLD.amount_due THEN
    INSERT INTO notifications (user_id, building_id, type, title, body)
    SELECT m.user_id, NEW.building_id, 'dues_updated',
           'Dues updated',
           'Your dues for ' || NEW.period_label || ' were updated to $' || NEW.amount_due
    FROM memberships m
    WHERE m.unit_id = NEW.unit_id AND m.ended_at IS NULL
      AND (
        (NEW.billed_to = 'tenant' AND m.tenure = 'tenant'
           AND (NEW.tenant_id IS NULL OR m.user_id = NEW.tenant_id))
        OR (NEW.billed_to <> 'tenant' AND m.tenure = 'owner')
      );
  END IF;
  RETURN NEW;
END; $$;

-- 4. The purge marks dues suppressed before the cascade deletes them.
CREATE OR REPLACE FUNCTION purge_soft_deleted()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT := 0; v_c INT; t TEXT;
BEGIN
  -- 0144: silence the dues-removed storm — flag every due about to cascade away
  -- (via its unit or its building crossing the 30-day line) so neither the
  -- in-app trigger nor the webhook fires when the cascade deletes it.
  UPDATE dues SET notify_suppressed = TRUE
   WHERE notify_suppressed = FALSE
     AND (
       unit_id IN (SELECT id FROM units
                    WHERE deleted_at IS NOT NULL AND deleted_at < now() - INTERVAL '30 days')
       OR building_id IN (SELECT id FROM buildings
                    WHERE deleted_at IS NOT NULL AND deleted_at < now() - INTERVAL '30 days')
     );

  -- units first, then buildings/compounds, then orgs — reduce cascade surprises.
  FOREACH t IN ARRAY ARRAY['units','buildings','compounds','organizations'] LOOP
    EXECUTE format('DELETE FROM %I WHERE deleted_at IS NOT NULL AND deleted_at < now() - INTERVAL ''30 days''', t);
    GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n + v_c;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION purge_soft_deleted() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Post-run checks:
--   Trash a unit, backdate deleted_at 31 days, SELECT purge_soft_deleted() →
--     the unit's dues cascade away with NO dues_removed notification, and the
--     DELETE webhook payload carries notify_suppressed=true (dynamic-action skips).
--   A normal manager dues delete (notify_suppressed=false) → still notifies.
