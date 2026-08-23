-- ============================================================
-- 0113_licenses_removed_event.sql
-- Let a scope admin log that they REMOVED licences.
--
-- The Licences page can now lower license_count (down to what is assigned).
-- The 0041 audit-log guard lets non-platform writers log only the events the
-- app performs, and 'licenses_removed' was not one of them, so the new action
-- would have failed at the audit step. Same guard, one more event.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION subscription_events_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL OR is_platform_admin() THEN RETURN NEW; END IF;

  -- Non-platform writers can only log what the app actually does, as themselves.
  NEW.actor_id := auth.uid();
  IF NEW.event_type NOT IN ('license_assigned', 'license_unassigned', 'licenses_added', 'licenses_removed') THEN
    RAISE EXCEPTION 'Invalid event type for this account.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
