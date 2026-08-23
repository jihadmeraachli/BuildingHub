-- ============================================================
-- 0118_license_downgrade.sql — a paid cycle keeps what it paid for.
--
-- Field feedback: removing licences dropped license_count immediately, so an
-- admin who paid for 25 licences until December lost access to 10 of them in
-- August the moment they scheduled a downgrade. Wrong way around. The rule
-- every serious SaaS applies, now here too:
--
--   · On an ACTIVE subscription, a removal is SCHEDULED, not applied:
--     `renews_license_count` records the count the NEXT renewal will have.
--     Until period end nothing changes — all paid licences stay usable.
--   · The renewal is priced at the scheduled count (lower band), which is
--     what the customer already observed working — kept.
--   · The schedule is REVERTIBLE any time before renewal (and adding
--     licences also cancels it: asking for more means the downgrade is off).
--   · The reduction lands inside settle_payment_intent when the renewal is
--     paid — clamped so it can never go below units held or assignments.
--   · On TRIAL (nothing paid) removal still applies immediately.
--
-- Additive & idempotent (functions redefined via CREATE OR REPLACE).
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. The scheduled count
-- ------------------------------------------------------------
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS renews_license_count INT;
COMMENT ON COLUMN subscriptions.renews_license_count IS
  'NULL = renew at license_count. Set = the next renewal applies this lower count (0118); paid licences stay usable until then; revertible before renewal.';

-- ------------------------------------------------------------
-- 2. Audit guard: two more events the app performs (extends 0113)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION subscription_events_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL OR is_platform_admin() THEN RETURN NEW; END IF;
  NEW.actor_id := auth.uid();
  IF NEW.event_type NOT IN ('license_assigned', 'license_unassigned', 'licenses_added', 'licenses_removed',
                            'licenses_removal_scheduled', 'licenses_removal_reverted') THEN
    RAISE EXCEPTION 'Invalid event type for this account.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 3. schedule_license_reduction — the Remove-licences button
-- ------------------------------------------------------------
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

  -- cumulative: a second removal deepens the scheduled one
  v_target := COALESCE(v_sub.renews_license_count, v_sub.license_count) - p_remove;
  v_units := subscription_unit_count(p_subscription);
  SELECT count(*) INTO v_assigned FROM license_assignments
   WHERE subscription_id = p_subscription AND unassigned_at IS NULL;
  IF v_target < GREATEST(1, v_units, v_assigned) THEN
    RAISE EXCEPTION 'LICENSE_FLOOR: you hold % units and % assigned licences; remove units or unassign first.', v_units, v_assigned
      USING ERRCODE = 'P0003';
  END IF;

  IF v_sub.status = 'active' AND v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end >= CURRENT_DATE THEN
    -- paid cycle: schedule it — nothing is taken away today
    UPDATE subscriptions
       SET renews_license_count = CASE WHEN v_target = license_count THEN NULL ELSE v_target END
     WHERE id = p_subscription;
    INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
    VALUES (p_subscription, 'licenses_removal_scheduled', auth.uid(),
            jsonb_build_object('removed', p_remove, 'renews_at', v_target, 'effective', v_sub.current_period_end + 1));
    RETURN QUERY SELECT FALSE, v_target, v_sub.current_period_end + 1;
  ELSE
    -- trial / no paid period: nothing was bought, apply now
    UPDATE subscriptions SET license_count = v_target, renews_license_count = NULL WHERE id = p_subscription;
    INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
    VALUES (p_subscription, 'licenses_removed', auth.uid(),
            jsonb_build_object('removed', p_remove, 'new_total', v_target));
    RETURN QUERY SELECT TRUE, v_target, CURRENT_DATE;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION schedule_license_reduction(UUID, INT) TO authenticated;

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
  INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
  VALUES (p_subscription, 'licenses_removal_reverted', auth.uid(), jsonb_build_object('was_scheduled', v_had));
  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION cancel_license_reduction(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 4. Renewals are priced at the SCHEDULED count (create_payment_intent,
--    redefined from 0117 with one change in the period branch)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_payment_intent(
  p_subscription UUID, p_kind TEXT, p_plan TEXT DEFAULT NULL, p_add INT DEFAULT NULL)
RETURNS TABLE(intent_id UUID, amount_cents INT, period_start DATE, period_end DATE, collect_url TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sub RECORD; v_plan TEXT; v_start DATE; v_end DATE; v_amount INT; v_monthly INT; v_row RECORD;
  v_role TEXT := current_setting('request.jwt.claim.role', true);
BEGIN
  IF NOT (v_role = 'service_role' OR current_user = 'service_role'
          OR is_platform_admin() OR user_manages_subscription(p_subscription)) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription FOR UPDATE;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'Subscription not found.' USING ERRCODE = '22023'; END IF;
  IF v_sub.status = 'cancelled' THEN RAISE EXCEPTION 'This subscription is cancelled.' USING ERRCODE = '22023'; END IF;

  IF p_kind = 'period' THEN
    v_plan := COALESCE(p_plan, v_sub.plan);
    IF v_plan NOT IN ('monthly','annual') THEN RAISE EXCEPTION 'Unknown plan.' USING ERRCODE = '22023'; END IF;
    v_start := CASE
      WHEN v_sub.status = 'trial' AND v_sub.trial_ends_at > now() THEN (v_sub.trial_ends_at::date + 1)
      WHEN v_sub.status = 'active' AND v_sub.current_period_end >= CURRENT_DATE THEN v_sub.current_period_end + 1
      ELSE CURRENT_DATE END;
    v_end := period_end_for(v_plan, v_start);
    -- 0118: a scheduled downgrade renews at the LOWER count's band
    v_monthly := COALESCE(v_sub.price_monthly_cents,
                          monthly_price_cents(COALESCE(v_sub.renews_license_count, v_sub.license_count)));
    IF v_monthly IS NULL THEN
      RAISE EXCEPTION 'This subscription is priced by agreement — contact the Abniyah team.' USING ERRCODE = 'P0005';
    END IF;
    v_amount := CASE WHEN v_plan = 'annual' THEN v_monthly * 10 ELSE v_monthly END;
  ELSIF p_kind = 'topup' THEN
    IF COALESCE(p_add, 0) < 1 THEN RAISE EXCEPTION 'Nothing to add.' USING ERRCODE = '22023'; END IF;
    v_amount := topup_amount_cents(p_subscription, p_add);
    IF v_amount IS NULL THEN RAISE EXCEPTION 'No top-up is due for this add.' USING ERRCODE = '22023'; END IF;
    v_plan := v_sub.plan; v_start := CURRENT_DATE; v_end := v_sub.current_period_end;
  ELSE
    RAISE EXCEPTION 'Unknown intent kind.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM payment_intents pi
   WHERE pi.subscription_id = p_subscription AND pi.kind = p_kind AND pi.status = 'pending'
     AND pi.amount_cents = v_amount AND pi.period_start = v_start
     AND COALESCE(pi.plan, '') = COALESCE(v_plan, '') AND COALESCE(pi.add_count, 0) = COALESCE(p_add, 0)
   ORDER BY pi.created_at DESC LIMIT 1;
  IF v_row.id IS NOT NULL THEN
    RETURN QUERY SELECT v_row.id, v_row.amount_cents, v_row.period_start, v_row.period_end, v_row.collect_url;
    RETURN;
  END IF;
  UPDATE payment_intents SET status = 'expired', updated_at = now()
   WHERE payment_intents.subscription_id = p_subscription AND payment_intents.kind = p_kind AND payment_intents.status = 'pending';

  RETURN QUERY
  INSERT INTO payment_intents (subscription_id, kind, plan, add_count, amount_cents, period_start, period_end, created_by)
  VALUES (p_subscription, p_kind, v_plan, p_add, v_amount, v_start, v_end, auth.uid())
  RETURNING payment_intents.id, payment_intents.amount_cents, payment_intents.period_start, payment_intents.period_end, payment_intents.collect_url;
END;
$$;
GRANT EXECUTE ON FUNCTION create_payment_intent(UUID, TEXT, TEXT, INT) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. The reduction LANDS when the renewal is paid (settle_payment_intent,
--    redefined from 0117: period branch applies renews_license_count,
--    clamped to units held and assignments — never strands data)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION settle_payment_intent(p_intent UUID, p_method TEXT, p_ref TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_int RECORD; v_sub RECORD; v_inv UUID; v_new INT; v_count INT; v_assigned INT;
        v_role TEXT := current_setting('request.jwt.claim.role', true);
BEGIN
  IF NOT (is_platform_admin() OR v_role = 'service_role' OR current_user = 'service_role') THEN
    RAISE EXCEPTION 'Not allowed to settle payments.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_int FROM payment_intents WHERE id = p_intent FOR UPDATE;
  IF v_int IS NULL THEN RAISE EXCEPTION 'Payment intent not found.' USING ERRCODE = '22023'; END IF;
  IF v_int.status = 'paid' THEN RETURN v_int.invoice_id; END IF;
  SELECT * INTO v_sub FROM subscriptions WHERE id = v_int.subscription_id FOR UPDATE;

  IF v_int.kind = 'period' THEN
    IF v_int.plan IS NOT NULL AND v_int.plan <> v_sub.plan THEN
      UPDATE subscriptions SET plan = v_int.plan WHERE id = v_sub.id;
    END IF;
    -- 0118: apply the scheduled downgrade now that its cycle begins
    v_count := COALESCE(v_sub.renews_license_count, v_sub.license_count);
    SELECT count(*) INTO v_assigned FROM license_assignments
     WHERE subscription_id = v_sub.id AND unassigned_at IS NULL;
    v_count := GREATEST(v_count, v_assigned, subscription_unit_count(v_sub.id), 1);
    INSERT INTO invoices (subscription_id, amount_cents, status, period_start, period_end, kind,
                          license_count, description, paid_at, paid_by, payment_method, payment_ref)
    VALUES (v_sub.id, v_int.amount_cents, 'paid', v_int.period_start, v_int.period_end, 'period',
            v_count, format('%s licences · %s', v_count, COALESCE(v_int.plan, v_sub.plan)),
            now(), auth.uid(), COALESCE(p_method, 'manual'), p_ref)
    RETURNING id INTO v_inv;
    UPDATE subscriptions
       SET status = 'active', current_period_start = v_int.period_start, current_period_end = v_int.period_end,
           license_count = v_count, renews_license_count = NULL,
           trial_ends_at = NULL, grace_ends_at = NULL, locked_at = NULL,
           cancel_at_period_end = FALSE, cancelled_at = NULL,
           payment_provider = COALESCE(CASE WHEN p_method IN ('whish','areeba') THEN p_method END, payment_provider)
     WHERE id = v_sub.id;
    IF v_count < v_sub.license_count THEN
      INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
      VALUES (v_sub.id, 'licenses_removed', auth.uid(),
              jsonb_build_object('via', 'renewal', 'from', v_sub.license_count, 'new_total', v_count));
    END IF;
  ELSE
    v_new := v_sub.license_count + COALESCE(v_int.add_count, 0);
    INSERT INTO invoices (subscription_id, amount_cents, status, period_start, period_end, kind,
                          license_count, description, paid_at, paid_by, payment_method, payment_ref)
    VALUES (v_sub.id, v_int.amount_cents, 'paid', v_int.period_start, v_int.period_end, 'topup',
            v_new, format('Top-up: %s → %s licences', v_sub.license_count, v_new),
            now(), auth.uid(), COALESCE(p_method, 'manual'), p_ref)
    RETURNING id INTO v_inv;
    UPDATE subscriptions
       SET license_count = v_new,
           payment_provider = COALESCE(CASE WHEN p_method IN ('whish','areeba') THEN p_method END, payment_provider)
     WHERE id = v_sub.id;
    INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
    VALUES (v_sub.id, 'licenses_added', auth.uid(),
            jsonb_build_object('via', 'topup_paid', 'added', v_int.add_count, 'new_total', v_new));
  END IF;

  UPDATE payment_intents
     SET status = 'paid', provider = p_method, provider_ref = p_ref, invoice_id = v_inv, updated_at = now()
   WHERE id = p_intent;
  INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
  VALUES (v_sub.id, 'invoice_paid', auth.uid(),
          jsonb_build_object('invoice_id', v_inv, 'intent_id', p_intent, 'amount_cents', v_int.amount_cents,
                             'method', COALESCE(p_method,'manual'), 'ref', p_ref, 'kind', v_int.kind));
  RETURN v_inv;
END;
$$;
REVOKE ALL ON FUNCTION settle_payment_intent(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION settle_payment_intent(UUID, TEXT, TEXT) TO service_role;

-- ------------------------------------------------------------
-- 6. Adding licences cancels a scheduled reduction — asking for more
--    means the downgrade is off (request_license_increase, redefined)
-- ------------------------------------------------------------
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
GRANT EXECUTE ON FUNCTION request_license_increase(UUID, INT) TO authenticated;

COMMIT;

-- Post-run checks:
--   1. Active sub, 25 licences: schedule_license_reduction(sub, 10) →
--      (immediate=false, new_count=15, effective=<period_end+1>);
--      license_count still 25 — all licences usable.
--   2. create_payment_intent(sub, 'period') → amount = the 15-licence band.
--   3. cancel_license_reduction(sub) → renews_license_count NULL again;
--      the next intent prices at 25.
--   4. Schedule again, settle the renewal → license_count becomes 15,
--      'licenses_removed' via renewal in the events, receipt says 15.
--   5. Trial sub: schedule_license_reduction → immediate=true, count drops now.
--   6. Schedule a reduction, then add licences → schedule cleared
--      ('licenses_removal_reverted' via license_add in the events).
