-- ============================================================
-- 0148_billing_rpc_guard_flag.sql
-- Found live by Jey testing the customer billing flow as the Bahloul admin:
-- "Cancel subscription" fails with "Billing fields are managed by the Abniyah
-- team" for every NON-platform-admin customer.
--
-- Root cause: cancel_subscription() / resume_subscription() /
-- start_subscription() legitimately write cancelled_at (and friends), but the
-- subscriptions_column_guard trigger judges the CALLER (auth.uid() is the
-- customer inside a SECURITY DEFINER RPC), and cancelled_at sits on the
-- guarded-column list. The sanctioned RPCs trip their own safety rail.
--
-- Fix: the 0108 grant-sweep pattern. Each sanctioned RPC sets a
-- transaction-local flag (abniyah.billing_rpc) after its own auth check, and
-- the guard honors it. Only our SECURITY DEFINER functions can set it, and it
-- dies with the transaction, so direct table writes stay guarded exactly as
-- before. Also drops the em-dash from the error copy (app style rule).
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- 1. The guard honors the sanctioned-RPC flag (and keeps every other rule).
CREATE OR REPLACE FUNCTION subscriptions_column_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL OR is_platform_admin() THEN RETURN NEW; END IF;
  -- 0148: a sanctioned billing RPC (cancel/resume/start) did its own auth
  -- check and set this transaction-local flag before writing.
  IF current_setting('abniyah.billing_rpc', true) = '1' THEN RETURN NEW; END IF;
  IF NEW.status               IS DISTINCT FROM OLD.status
     OR NEW.trial_ends_at     IS DISTINCT FROM OLD.trial_ends_at
     OR NEW.current_period_start IS DISTINCT FROM OLD.current_period_start
     OR NEW.current_period_end   IS DISTINCT FROM OLD.current_period_end
     OR NEW.price_per_unit_cents IS DISTINCT FROM OLD.price_per_unit_cents
     OR NEW.price_monthly_cents  IS DISTINCT FROM OLD.price_monthly_cents
     OR NEW.grace_ends_at     IS DISTINCT FROM OLD.grace_ends_at
     OR NEW.locked_at         IS DISTINCT FROM OLD.locked_at
     OR NEW.cancelled_at      IS DISTINCT FROM OLD.cancelled_at
     OR NEW.provider_customer_ref IS DISTINCT FROM OLD.provider_customer_ref
     OR NEW.scope_type        IS DISTINCT FROM OLD.scope_type
     OR NEW.building_id       IS DISTINCT FROM OLD.building_id
     OR NEW.compound_id       IS DISTINCT FROM OLD.compound_id
     OR NEW.org_id            IS DISTINCT FROM OLD.org_id
     OR NEW.created_by        IS DISTINCT FROM OLD.created_by
     OR NEW.created_at        IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Billing fields are managed by the Abniyah team. Contact support.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.auto_renew AND NOT OLD.auto_renew AND NEW.provider_customer_ref IS NULL THEN
    RAISE EXCEPTION 'Save a card first to turn on auto-renew.' USING ERRCODE = 'P0004';
  END IF;
  RETURN NEW;
END;
$$;

-- 2. The three customer-callable writers raise the flag AFTER their auth check.
CREATE OR REPLACE FUNCTION cancel_subscription(p_subscription UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT user_manages_subscription(p_subscription) THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('abniyah.billing_rpc', '1', true);   -- 0148
  UPDATE subscriptions SET cancel_at_period_end = TRUE, cancelled_at = now(), auto_renew = FALSE WHERE id = p_subscription;
  INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
  VALUES (p_subscription, 'cancel_requested', auth.uid(), '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION resume_subscription(p_subscription UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT user_manages_subscription(p_subscription) THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('abniyah.billing_rpc', '1', true);   -- 0148
  UPDATE subscriptions SET cancel_at_period_end = FALSE, cancelled_at = NULL WHERE id = p_subscription AND status <> 'cancelled';
  INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
  VALUES (p_subscription, 'cancel_withdrawn', auth.uid(), '{}'::jsonb);
END;
$$;

-- Legacy pre-0117 path, still granted to authenticated - same trap, same fix.
CREATE OR REPLACE FUNCTION start_subscription(p_subscription UUID, p_plan TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sub RECORD; v_start DATE;
BEGIN
  IF NOT user_manages_subscription(p_subscription) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('abniyah.billing_rpc', '1', true);   -- 0148
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription FOR UPDATE;
  IF v_sub.status = 'cancelled' THEN RAISE EXCEPTION 'This subscription is cancelled.' USING ERRCODE = '22023'; END IF;
  IF p_plan IS NOT NULL AND p_plan IN ('monthly','annual') AND p_plan <> v_sub.plan THEN
    UPDATE subscriptions SET plan = p_plan WHERE id = p_subscription;   -- applies to the invoice below
  END IF;
  v_start := CASE WHEN v_sub.status = 'active' AND v_sub.current_period_end >= CURRENT_DATE
                  THEN v_sub.current_period_end + 1 ELSE CURRENT_DATE END;
  UPDATE subscriptions SET cancel_at_period_end = FALSE, cancelled_at = NULL WHERE id = p_subscription;
  RETURN issue_period_invoice(p_subscription, v_start);
END;
$$;

COMMIT;

-- Post-run checks:
--   As a building admin (NOT platform admin): Cancel subscription -> succeeds,
--     card shows "ends at period end"; Resume -> succeeds and clears it.
--   As the same admin, a DIRECT update (supabase.from('subscriptions').update
--     ({cancelled_at: ...})) -> still rejected 42501. The flag never leaks:
--     it is transaction-local and only set inside the SECURITY DEFINER RPCs.
