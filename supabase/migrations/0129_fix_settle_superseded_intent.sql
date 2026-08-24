-- ============================================================
-- 0129_fix_settle_superseded_intent.sql
-- SECURITY/MONEY FIX (audit H5, HIGH): settle_payment_intent settled
-- superseded (expired/failed) intents.
--
-- THE HOLE. When a customer changes plan/count and clicks Pay again,
-- create_payment_intent (0117) marks the previous intent 'expired' — but the
-- Whish hosted page for it is still open (its collect_url is never revoked).
-- settle_payment_intent short-circuited only on status = 'paid'; an 'expired'
-- or 'failed' intent fell straight through and settled. Paying the still-open
-- old link activated the abandoned plan; completing both links charged twice.
--
-- THE FIX. Reject any intent that is not 'pending' (after the idempotent
-- 'paid' fast-path). The only status a settle may act on is 'pending'.
-- whish-callback / areeba-callback treat this as terminal (see note below),
-- not a retryable error.
--
-- Additive & idempotent. Body is 0118's verbatim, with one guard line added.
-- ============================================================
BEGIN;

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
  -- 0129: never settle a superseded link. Only a pending intent may settle.
  IF v_int.status <> 'pending' THEN
    RAISE EXCEPTION 'This payment link is no longer valid.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_sub FROM subscriptions WHERE id = v_int.subscription_id FOR UPDATE;

  IF v_int.kind = 'period' THEN
    IF v_int.plan IS NOT NULL AND v_int.plan <> v_sub.plan THEN
      UPDATE subscriptions SET plan = v_int.plan WHERE id = v_sub.id;
    END IF;
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

COMMIT;

-- NOTE for whish-callback / areeba-callback (edge functions): a 22023 from
-- settle now means "the link was superseded" — record it and STOP, do not
-- retry/reconcile. If the customer's money did land on a superseded intent,
-- that is a refund case, not a re-settle. (No code change required for
-- correctness — the callbacks already treat a raised settle as terminal for
-- that intent — but worth a comment when they are next touched.)
--
-- Post-run checks:
--   Start a period payment, change plan, pay the FIRST (now expired) link →
--     settle raises 'This payment link is no longer valid.', no invoice.
--   Pay the current pending link → settles once, as before.
--   Re-deliver the same successful callback → still idempotent (status 'paid').
