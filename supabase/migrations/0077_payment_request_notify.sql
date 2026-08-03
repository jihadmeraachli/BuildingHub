-- ============================================================
-- 0077_payment_request_notify.sql
-- A payment request notified nobody when it was issued.
--
-- 0076 built the obligation and the daily/weekly reminder rhythm, but the
-- reminders only run from the pg_cron job at 06:00 UTC. So pressing "Send
-- request" wrote the rows and sent nothing, and the first notice would not
-- reach anyone until the next morning — while the button says it sent.
--
-- Charges (trg_notify_charge, 0009/0067) and dues (0015/0070) both notify on
-- INSERT. Payment requests now do the same, on the same party-aware basis:
-- the notice reaches ONLY the party being asked, and a request already
-- reassigned to the owner (departed tenant, 0076) reaches the owner.
--
-- Email/WhatsApp ride the usual path: this trigger fills the in-app bell, and
-- a Database Webhook on payment_request_lines INSERT → dynamic-action sends the
-- rest. ⚠️ THAT WEBHOOK MUST BE ADDED (Database → Webhooks) or only the bell
-- fires — the same footgun as the adjustments webhook in 0067.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION notify_on_payment_request() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_party TEXT;
  v_due   DATE;
  v_label TEXT;
BEGIN
  SELECT r.due_date, r.label INTO v_due, v_label
  FROM payment_requests r WHERE r.id = NEW.request_id;

  -- a line already reassigned to the owner must reach the owner, not chase a
  -- tenant who has moved out
  v_party := effective_obligation_party(NEW.unit_id, NEW.party, NEW.tenant_id);

  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT m.user_id, NEW.building_id, 'payment_requested',
         'Payment requested',
         COALESCE(v_label || ': ', '') || '$' || NEW.amount_requested ||
         COALESCE(' — due ' || v_due::text, '')
  FROM memberships m
  WHERE m.unit_id = NEW.unit_id AND m.ended_at IS NULL
    AND (
      (v_party = 'tenant' AND m.tenure = 'tenant'
         AND (NEW.tenant_id IS NULL OR m.user_id = NEW.tenant_id))
      OR (v_party = 'owner' AND m.tenure = 'owner')
    );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_payment_request ON payment_request_lines;
CREATE TRIGGER trg_notify_payment_request
  AFTER INSERT ON payment_request_lines
  FOR EACH ROW EXECUTE FUNCTION notify_on_payment_request();

-- The bell's type column is a plain TEXT in practice, but keep the app's list
-- honest for anything that switches on it.
COMMENT ON FUNCTION notify_on_payment_request() IS
  'In-app notice when a payment request line is issued. Party-aware; a line offloaded to the owner notifies the owner. Email/WhatsApp come from the payment_request_lines webhook → dynamic-action.';

COMMIT;

-- ============================================================
-- Post-run checks:
--   1. Issue a request on a test building → the billed party gets a 🔔 and the
--      OTHER party does not.
--   2. On a leased unit, a tenant line notifies the tenant; end that tenancy,
--      issue again, and it notifies the owner.
--   3. ⚠️ ADD THE WEBHOOK or email/WhatsApp stay silent:
--      Database → Webhooks → new → table `payment_request_lines`,
--      events: Insert only, POST to the `dynamic-action` function
--      (copy an existing webhook's config, e.g. charges).
-- ============================================================
