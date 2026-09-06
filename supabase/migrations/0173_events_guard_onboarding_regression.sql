-- ============================================================
-- 0173_events_guard_onboarding_regression.sql
-- QA sweep 2026-09-06: SELF-SERVICE REGISTRATION IS BROKEN — the wizard's
-- finalize dies on "Invalid event type for this account." and the new
-- customer is dumped back at step 0 with no building.
--
-- Root cause: the same regression 0046 fixed, reintroduced. The
-- subscription_events_guard has now been rebuilt four times (0041 → 0046 →
-- 0113 → 0114 → 0118 → 0149) and every rebuild after 0046 copied from a
-- version that lacked the onboarding sanction — so 'trial_started', logged
-- by complete_admin_onboarding() as the registrant, has been rejected since
-- 0113 shipped. (0149 fixed the identical pattern for the BILLING events;
-- this restores the ONBOARDING one.)
--
-- ⚠️ THE RULE, for the next person who rebuilds this function: edit the
-- LATEST version and keep the UNION of every sanction —
--   1. abniyah.billing_rpc flag        (0148/0149)
--   2. abniyah.onboarding + trial_started (0037/0046, restored here)
--   3. the full license + billing allowlist (0118 + 0114 via 0149)
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
  -- 0046, restored by 0173: complete_admin_onboarding() logs trial_started
  -- as the new registrant under the transaction-local onboarding flag.
  IF current_setting('abniyah.onboarding', true) = '1' AND NEW.event_type = 'trial_started' THEN
    RETURN NEW;
  END IF;
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
--   1. Register a fresh building admin end-to-end (confirm email → login):
--      lands on /dashboard, buildings/subscriptions/grants rows exist,
--      subscription_events has the trial_started row with the right actor.
--   2. Licenses page: assign/unassign still works (allowlist unchanged).
--   3. Cancel/withdraw subscription still works (billing_rpc flag unchanged).
