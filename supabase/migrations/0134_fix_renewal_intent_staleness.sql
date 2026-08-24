-- ============================================================
-- 0134_fix_renewal_intent_staleness.sql
-- MONEY FIX (audit M2, medium): a renewal intent kept its frozen (low) price
-- while the applied licence count diverged → under-collection.
--
-- THE HOLE. create_payment_intent freezes amount_cents from the count at
-- creation. settle_payment_intent re-reads the count LIVE and clamps it up.
-- schedule_license_reduction / cancel_license_reduction / request_license_increase
-- all change renews_license_count but never touch a pending period intent — so
-- after e.g. schedule 25→15 ($85 intent created), cancel the reduction, paying
-- the still-open $85 link granted 25 licences for the 15-band price.
--
-- THE FIX. Whenever the renewal count changes, expire any pending PERIOD
-- intent (same one-liner create_payment_intent already uses for plan changes).
-- The customer's next visit mints a fresh, correctly-priced intent; and if they
-- pay the now-expired old link, 0129's non-pending guard rejects it cleanly
-- instead of settling the wrong amount. The two fixes compose exactly.
--
-- Bodies below are 0118's verbatim, each with ONE added UPDATE. Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION schedule_license_reduction(p_subscription UUID, p_remove INT)
RETURNS TABLE(immediate BOOLEAN, new_count INT, effective_date DATE)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sub RECORD; v_target INT; v_units INT; v_assigned INT;
BEGIN
  IF NOT user_manages_subscription(p_subscription) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  IF p_remove IS NULL OR p_remove < 1 THEN RAISE EXCEPTION 'Nothing to remove.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription FOR UPDATE;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'Subscription not found.' USING ERRCODE = '22023'; END IF;

  v_target := COALESCE(v_sub.renews_license_count, v_sub.license_count) - p_remove;
  v_units := subscription_unit_count(p_subscription);
  SELECT count(*) INTO v_assigned FROM license_assignments
   WHERE subscription_id = p_subscription AND unassigned_at IS NULL;
  IF v_target < GREATEST(1, v_units, v_assigned) THEN
    RAISE EXCEPTION 'LICENSE_FLOOR: you hold % units and % assigned licences; remove units or unassign first.', v_units, v_assigned
      USING ERRCODE = 'P0003';
  END IF;

  IF v_sub.status = 'active' AND v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end >= CURRENT_DATE THEN
    UPDATE subscriptions
       SET renews_license_count = CASE WHEN v_target = license_count THEN NULL ELSE v_target END
     WHERE id = p_subscription;
    -- 0134: the renewal price just changed — invalidate any open renewal link.
    UPDATE payment_intents SET status = 'expired', updated_at = now()
     WHERE subscription_id = p_subscription AND kind = 'period' AND status = 'pending';
    INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
    VALUES (p_subscription, 'licenses_removal_scheduled', auth.uid(),
            jsonb_build_object('removed', p_remove, 'renews_at', v_target, 'effective', v_sub.current_period_end + 1));
    RETURN QUERY SELECT FALSE, v_target, v_sub.current_period_end + 1;
  ELSE
    UPDATE subscriptions SET license_count = v_target, renews_license_count = NULL WHERE id = p_subscription;
    INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
    VALUES (p_subscription, 'licenses_removed', auth.uid(),
            jsonb_build_object('removed', p_remove, 'new_total', v_target));
    RETURN QUERY SELECT TRUE, v_target, CURRENT_DATE;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION cancel_license_reduction(p_subscription UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_had INT;
BEGIN
  IF NOT user_manages_subscription(p_subscription) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  SELECT renews_license_count INTO v_had FROM subscriptions WHERE id = p_subscription FOR UPDATE;
  IF v_had IS NULL THEN RETURN FALSE; END IF;
  UPDATE subscriptions SET renews_license_count = NULL WHERE id = p_subscription;
  -- 0134: the renewal price reverted — invalidate any open renewal link.
  UPDATE payment_intents SET status = 'expired', updated_at = now()
   WHERE subscription_id = p_subscription AND kind = 'period' AND status = 'pending';
  INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
  VALUES (p_subscription, 'licenses_removal_reverted', auth.uid(), jsonb_build_object('was_scheduled', v_had));
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION request_license_increase(p_subscription UUID, p_add INT)
RETURNS TABLE(applied BOOLEAN, amount_cents INT) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sub RECORD; v_new INT; v_amount INT;
BEGIN
  IF NOT user_manages_subscription(p_subscription) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  IF p_add IS NULL OR p_add < 1 THEN RAISE EXCEPTION 'Nothing to add.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription FOR UPDATE;
  IF v_sub.renews_license_count IS NOT NULL THEN
    UPDATE subscriptions SET renews_license_count = NULL WHERE id = p_subscription;
    -- 0134: a scheduled reduction was just reverted by adding — the pending
    -- renewal link was priced for the lower count, so invalidate it.
    UPDATE payment_intents SET status = 'expired', updated_at = now()
     WHERE subscription_id = p_subscription AND kind = 'period' AND status = 'pending';
    INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
    VALUES (p_subscription, 'licenses_removal_reverted', auth.uid(), jsonb_build_object('via', 'license_add'));
  END IF;
  v_new := v_sub.license_count + p_add;
  v_amount := topup_amount_cents(p_subscription, p_add);
  IF v_amount IS NULL THEN
    UPDATE subscriptions SET license_count = v_new WHERE id = p_subscription;
    INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
    VALUES (p_subscription, 'licenses_added', auth.uid(), jsonb_build_object('added', p_add, 'new_total', v_new));
    RETURN QUERY SELECT TRUE, NULL::INT;
  ELSE
    RETURN QUERY SELECT FALSE, v_amount;
  END IF;
END;
$$;

COMMIT;

-- Post-run checks:
--   schedule 25→15 (creates renewal intent), cancel the reduction, then open the
--     old Whish link → settle rejects it ('payment link no longer valid', 0129);
--     a fresh renewal is priced for 25. No under-collection.
--   Normal schedule → renew → the scheduled count applies at the frozen price. OK.
--   Add licences while a reduction was scheduled → pending renewal link invalidated.
