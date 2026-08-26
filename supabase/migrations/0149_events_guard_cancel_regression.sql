-- ============================================================
-- 0149_events_guard_cancel_regression.sql
-- Second half of the cancel-subscription bug (found live by Jey, right after
-- 0148): with the column guard fixed, cancel_subscription() then died on
-- "Invalid event type for this account."
--
-- Root cause: 0118 rebuilt subscription_events_guard for the downgrade events
-- and its allowlist silently DROPPED the 0114 self-service events -
-- cancel_requested, cancel_withdrawn, invoice_issued, auto_renew_on/off. A
-- customer could not log their own cancellation event.
--
-- Fix, symmetric with 0148:
--   1. The guard honors the same transaction-local abniyah.billing_rpc flag,
--      so events inserted by the sanctioned SECURITY DEFINER RPCs pass even if
--      the name list drifts again (actor_id is still stamped from auth.uid()).
--   2. The allowlist for any other insert is restored to the UNION of 0114 and
--      0118 - self-service events AND downgrade events.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION subscription_events_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL OR is_platform_admin() THEN RETURN NEW; END IF;
  NEW.actor_id := auth.uid();
  -- 0149: an event written by a sanctioned billing RPC (which already did its
  -- own auth check and raised the 0148 flag) is trusted.
  IF current_setting('abniyah.billing_rpc', true) = '1' THEN RETURN NEW; END IF;
  IF NEW.event_type NOT IN ('license_assigned', 'license_unassigned', 'licenses_added', 'licenses_removed',
                            'licenses_removal_scheduled', 'licenses_removal_reverted',
                            'invoice_issued', 'cancel_requested', 'cancel_withdrawn',
                            'auto_renew_on', 'auto_renew_off') THEN
    RAISE EXCEPTION 'Invalid event type for this account.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;

-- Post-run checks:
--   As the Bahloul admin: Cancel subscription -> succeeds end to end (column
--     guard passed by 0148, event insert passed here); Resume -> same.
--   As the same admin, a DIRECT insert into subscription_events with a bogus
--     event_type -> still rejected 42501 (the flag only exists inside the RPCs).
