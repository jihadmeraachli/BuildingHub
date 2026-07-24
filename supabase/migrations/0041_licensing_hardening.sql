-- ============================================================
-- 0041_licensing_hardening.sql
-- Audit findings H1, M4, M5: licensing was on the honor system.
--
-- H1 — scope admins could UPDATE any column of their own subscription
--      (status='active', trial_ends_at='2099-01-01', price, periods) with no
--      billing consequence. Now a trigger freezes billing-critical columns
--      for everyone except the platform operator / service role. Scope admins
--      keep exactly the self-service actions the UI offers: license_count,
--      billing_email, notes.
--
-- M4 — subscription_events (the licensing audit log) accepted any event_type
--      and any actor_id from scope admins — the audit trail could impersonate.
--      Now non-platform inserts are stamped actor_id = auth.uid() and limited
--      to the event types the app legitimately writes.
--
-- M5 — license_assignments never verified the unit belongs to the
--      subscription's scope; the UPDATE path allowed editing unit_id. Now a
--      trigger validates scope on INSERT and permits only the unassign fields
--      to change on UPDATE (for non-platform callers).
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- H1. Column freeze on subscriptions for non-platform callers.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION subscriptions_column_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Service role (edge functions) and the platform operator are trusted.
  IF auth.uid() IS NULL OR is_platform_admin() THEN RETURN NEW; END IF;

  IF NEW.status               IS DISTINCT FROM OLD.status
     OR NEW.plan              IS DISTINCT FROM OLD.plan
     OR NEW.trial_ends_at     IS DISTINCT FROM OLD.trial_ends_at
     OR NEW.current_period_start IS DISTINCT FROM OLD.current_period_start
     OR NEW.current_period_end   IS DISTINCT FROM OLD.current_period_end
     OR NEW.price_per_unit_cents IS DISTINCT FROM OLD.price_per_unit_cents
     OR NEW.scope_type        IS DISTINCT FROM OLD.scope_type
     OR NEW.building_id       IS DISTINCT FROM OLD.building_id
     OR NEW.compound_id       IS DISTINCT FROM OLD.compound_id
     OR NEW.org_id            IS DISTINCT FROM OLD.org_id
     OR NEW.created_by        IS DISTINCT FROM OLD.created_by
     OR NEW.created_at        IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Billing fields are managed by the Abniyah team — contact support.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscriptions_column_guard_trg ON subscriptions;
CREATE TRIGGER subscriptions_column_guard_trg
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION subscriptions_column_guard();

-- ------------------------------------------------------------
-- M4. Audit-log integrity on subscription_events.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION subscription_events_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL OR is_platform_admin() THEN RETURN NEW; END IF;

  -- Non-platform writers can only log what the app actually does, as themselves.
  NEW.actor_id := auth.uid();
  IF NEW.event_type NOT IN ('license_assigned', 'license_unassigned', 'licenses_added') THEN
    RAISE EXCEPTION 'Invalid event type for this account.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscription_events_guard_trg ON subscription_events;
CREATE TRIGGER subscription_events_guard_trg
  BEFORE INSERT ON subscription_events
  FOR EACH ROW EXECUTE FUNCTION subscription_events_guard();

-- ------------------------------------------------------------
-- M5. Assignment integrity: unit must belong to the subscription's scope;
--     non-platform UPDATE may only touch the unassign fields.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION license_assignments_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_ok BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT EXISTS (
      SELECT 1
      FROM subscriptions s
      JOIN units u ON u.id = NEW.unit_id
      WHERE s.id = NEW.subscription_id
        AND (
          (s.scope_type = 'building' AND u.building_id = s.building_id)
          OR (s.scope_type = 'compound' AND EXISTS (
                SELECT 1 FROM buildings b
                WHERE b.id = u.building_id AND b.compound_id = s.compound_id))
          OR (s.scope_type = 'org' AND EXISTS (
                SELECT 1 FROM org_buildings ob
                WHERE ob.building_id = u.building_id AND ob.org_id = s.org_id))
        )
    ) INTO v_ok;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'Unit is outside this subscription''s scope.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: non-platform callers may only set the unassign fields.
  IF auth.uid() IS NOT NULL AND NOT is_platform_admin() THEN
    IF NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
       OR NEW.unit_id      IS DISTINCT FROM OLD.unit_id
       OR NEW.assigned_at  IS DISTINCT FROM OLD.assigned_at
       OR NEW.assigned_by  IS DISTINCT FROM OLD.assigned_by THEN
      RAISE EXCEPTION 'Only unassignment may be recorded on an existing license.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS license_assignments_guard_trg ON license_assignments;
CREATE TRIGGER license_assignments_guard_trg
  BEFORE INSERT OR UPDATE ON license_assignments
  FOR EACH ROW EXECUTE FUNCTION license_assignments_guard();

COMMIT;

-- ============================================================
-- Post-run checks (as a scope admin in the app console):
--   1. supabase.from('subscriptions').update({status:'active'}).eq('id', mySub)
--      → 'Billing fields are managed by the Abniyah team'
--   2. supabase.from('subscriptions').update({license_count: 25}).eq('id', mySub)
--      → succeeds (self-service licenses keep working)
--   3. supabase.from('subscription_events').insert({subscription_id: mySub,
--      event_type:'invoice_paid', actor_id:'<other-uuid>'}) → rejected
--   4. Assigning a license to a unit of another building → rejected
-- ============================================================
