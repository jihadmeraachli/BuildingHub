-- ============================================================
-- 0046_onboarding_event_guard_fix.sql
-- Regression from 0041: subscription_events_guard limits non-platform writers
-- to the license event types — but complete_admin_onboarding() logs
-- 'trial_started' as the caller (SECURITY DEFINER keeps auth.uid() = the new
-- registrant), so self-service registration failed at its last step with
-- "Invalid event type for this account." and rolled back entirely.
--
-- Fix: the guard honors the same transaction-local onboarding flag as the
-- profile/grant guards (0037/0038) — during complete_admin_onboarding, the
-- 'trial_started' event is sanctioned. Everything else unchanged: outside
-- onboarding, non-platform writers still get actor stamping and the
-- license-event whitelist.
--
-- Additive & idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION subscription_events_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL OR is_platform_admin() THEN RETURN NEW; END IF;

  -- Non-platform writers always log as themselves.
  NEW.actor_id := auth.uid();

  -- Sanctioned onboarding (0037): complete_admin_onboarding() logs trial_started.
  IF current_setting('abniyah.onboarding', true) = '1' AND NEW.event_type = 'trial_started' THEN
    RETURN NEW;
  END IF;

  IF NEW.event_type NOT IN ('license_assigned', 'license_unassigned', 'licenses_added') THEN
    RAISE EXCEPTION 'Invalid event type for this account.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- (Trigger from 0041 already points at this function; CREATE OR REPLACE is enough.)

-- ============================================================
-- Post-run check: run the registration wizard end-to-end with a fresh email —
-- it must land on the dashboard with the trial visible in Platform Licensing.
-- ============================================================
