-- ============================================================
-- 0117_pay_first.sql — pay first, invoice after.
--
-- Field feedback from live testing: an OPEN invoice sitting on the Billing
-- page — sometimes for a period that starts in the future — reads as "you owe
-- us" before any decision was made, and it kept needing void-and-reissue
-- choreography (0116) whenever the plan changed under it. The fix is to stop
-- issuing paper ahead of money:
--
--   · Nothing creates an OPEN invoice any more. Not subscribe, not renewal
--     notices, not licence adds, not billing_tick.
--   · A payment starts as a PAYMENT INTENT (new table): amount computed
--     server-side, gateway session hangs off the intent id.
--   · When the gateway confirms, settle_payment_intent() creates the invoice
--     ALREADY PAID (it is the receipt) and applies the effect — period
--     activated, or held licences landed — in the same transaction.
--   · The UI's pre-payment signal is time, not paper: "renews / expires in
--     X days". billing_tick keeps the same notice cadence but carries a
--     computed amount instead of an invoice.
--
-- What stays: mark_invoice_paid (legacy manual settle, still valid),
-- user_can lock gates (0114), grace = trial-only (0116).
-- Cleanup at the end voids every open invoice: in the pay-first world an
-- open invoice is a contradiction. Additive & idempotent otherwise.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. payment_intents — the pre-payment object (invisible paper)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_intents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('period','topup')),
  plan            TEXT CHECK (plan IN ('monthly','annual')),   -- period intents: the cycle being bought
  add_count       INT,                                          -- topup intents: licences waiting on payment
  amount_cents    INT  NOT NULL CHECK (amount_cents > 0),
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','failed','expired')),
  collect_url     TEXT,                                         -- whish hosted page (resume, don't recreate)
  collect_status  TEXT,
  provider        TEXT,                                         -- whish | areeba (set on settle)
  provider_ref    TEXT,                                         -- gateway session/txn reference
  invoice_id      UUID REFERENCES invoices(id),                 -- the receipt, once settled
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_intents_sub_idx     ON payment_intents(subscription_id);
CREATE INDEX IF NOT EXISTS payment_intents_pending_idx ON payment_intents(subscription_id) WHERE status = 'pending';

ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;
-- Managers may LOOK (the UI resumes a pending payment); nobody writes from the
-- client — every mutation goes through the SECURITY DEFINER functions below.
DROP POLICY IF EXISTS "payment_intents_read" ON payment_intents;
CREATE POLICY "payment_intents_read" ON payment_intents FOR SELECT TO authenticated
  USING (user_manages_subscription(subscription_id));

-- ------------------------------------------------------------
-- 2. The prorated top-up amount, computed WITHOUT creating anything
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION topup_amount_cents(p_subscription UUID, p_add INT)
RETURNS INT LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_sub RECORD; v_old INT; v_new INT; v_days INT; v_left INT; v_amount INT; v_mult INT;
BEGIN
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription;
  IF v_sub IS NULL OR v_sub.status <> 'active' OR v_sub.current_period_end IS NULL THEN RETURN NULL; END IF;
  IF v_sub.price_monthly_cents IS NOT NULL THEN RETURN NULL; END IF;   -- negotiated: no automatic top-up
  v_old := monthly_price_cents(v_sub.license_count);
  v_new := monthly_price_cents(v_sub.license_count + p_add);
  IF v_old IS NULL OR v_new IS NULL OR v_new <= v_old THEN RETURN NULL; END IF;
  v_mult := CASE WHEN v_sub.plan = 'annual' THEN 10 ELSE 1 END;
  v_days := (v_sub.current_period_end - v_sub.current_period_start) + 1;
  v_left := GREATEST(0, v_sub.current_period_end - CURRENT_DATE + 1);
  v_amount := ROUND(((v_new - v_old) * v_mult)::numeric * v_left / v_days);
  IF v_amount < 100 THEN RETURN NULL; END IF;                          -- under a dollar: waive it
  RETURN v_amount;
END;
$$;
GRANT EXECUTE ON FUNCTION topup_amount_cents(UUID, INT) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. create_payment_intent — amount and dates decided HERE, server-side
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
    -- a live trial is not cut short: the paid period starts when it ends (13)
    v_start := CASE
      WHEN v_sub.status = 'trial' AND v_sub.trial_ends_at > now() THEN (v_sub.trial_ends_at::date + 1)
      WHEN v_sub.status = 'active' AND v_sub.current_period_end >= CURRENT_DATE THEN v_sub.current_period_end + 1
      ELSE CURRENT_DATE END;
    v_end := period_end_for(v_plan, v_start);
    v_monthly := subscription_monthly_cents(p_subscription);
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

  -- resume an identical pending intent (its Whish link is still payable) …
  SELECT * INTO v_row FROM payment_intents pi
   WHERE pi.subscription_id = p_subscription AND pi.kind = p_kind AND pi.status = 'pending'
     AND pi.amount_cents = v_amount AND pi.period_start = v_start
     AND COALESCE(pi.plan, '') = COALESCE(v_plan, '') AND COALESCE(pi.add_count, 0) = COALESCE(p_add, 0)
   ORDER BY pi.created_at DESC LIMIT 1;
  IF v_row.id IS NOT NULL THEN
    RETURN QUERY SELECT v_row.id, v_row.amount_cents, v_row.period_start, v_row.period_end, v_row.collect_url;
    RETURN;
  END IF;
  -- … and expire the ones the customer walked away from (changed plan/count)
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
-- 4. settle_payment_intent — money confirmed → receipt + effect, one txn
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION settle_payment_intent(p_intent UUID, p_method TEXT, p_ref TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_int RECORD; v_sub RECORD; v_inv UUID; v_new INT;
        v_role TEXT := current_setting('request.jwt.claim.role', true);
BEGIN
  IF NOT (is_platform_admin() OR v_role = 'service_role' OR current_user = 'service_role') THEN
    RAISE EXCEPTION 'Not allowed to settle payments.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_int FROM payment_intents WHERE id = p_intent FOR UPDATE;
  IF v_int IS NULL THEN RAISE EXCEPTION 'Payment intent not found.' USING ERRCODE = '22023'; END IF;
  IF v_int.status = 'paid' THEN RETURN v_int.invoice_id; END IF;       -- idempotent: gateways retry
  SELECT * INTO v_sub FROM subscriptions WHERE id = v_int.subscription_id FOR UPDATE;

  IF v_int.kind = 'period' THEN
    IF v_int.plan IS NOT NULL AND v_int.plan <> v_sub.plan THEN
      UPDATE subscriptions SET plan = v_int.plan WHERE id = v_sub.id;
    END IF;
    INSERT INTO invoices (subscription_id, amount_cents, status, period_start, period_end, kind,
                          license_count, description, paid_at, paid_by, payment_method, payment_ref)
    VALUES (v_sub.id, v_int.amount_cents, 'paid', v_int.period_start, v_int.period_end, 'period',
            v_sub.license_count, format('%s licences · %s', v_sub.license_count, COALESCE(v_int.plan, v_sub.plan)),
            now(), auth.uid(), COALESCE(p_method, 'manual'), p_ref)
    RETURNING id INTO v_inv;
    UPDATE subscriptions
       SET status = 'active', current_period_start = v_int.period_start, current_period_end = v_int.period_end,
           trial_ends_at = NULL, grace_ends_at = NULL, locked_at = NULL,
           cancel_at_period_end = FALSE, cancelled_at = NULL,
           payment_provider = COALESCE(CASE WHEN p_method IN ('whish','areeba') THEN p_method END, payment_provider)
     WHERE id = v_sub.id;
  ELSE  -- topup: the held licences land NOW, because the money just did
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

-- the gateway session bookkeeping (mirror of set_invoice_collect, 0099)
CREATE OR REPLACE FUNCTION set_intent_collect(p_intent UUID, p_url TEXT, p_status TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_role TEXT := current_setting('request.jwt.claim.role', true);
BEGIN
  IF NOT (is_platform_admin() OR v_role = 'service_role' OR current_user = 'service_role') THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  UPDATE payment_intents
     SET collect_url = COALESCE(p_url, collect_url),
         collect_status = COALESCE(p_status, collect_status),
         updated_at = now()
   WHERE id = p_intent;
END;
$$;
REVOKE ALL ON FUNCTION set_intent_collect(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_intent_collect(UUID, TEXT, TEXT) TO service_role;

-- ------------------------------------------------------------
-- 5. request_license_increase — same gate, but returns an AMOUNT, not paper
--    (return type changed → the old function must be dropped first)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS request_license_increase(UUID, INT);
CREATE FUNCTION request_license_increase(p_subscription UUID, p_add INT)
RETURNS TABLE(applied BOOLEAN, amount_cents INT) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sub RECORD; v_new INT; v_amount INT;
BEGIN
  IF NOT user_manages_subscription(p_subscription) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  IF p_add IS NULL OR p_add < 1 THEN RAISE EXCEPTION 'Nothing to add.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription FOR UPDATE;
  v_new := v_sub.license_count + p_add;
  v_amount := topup_amount_cents(p_subscription, p_add);
  IF v_amount IS NULL THEN
    -- trial, non-active, negotiated, within the band, or under a dollar: free to add now
    UPDATE subscriptions SET license_count = v_new WHERE id = p_subscription;
    INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
    VALUES (p_subscription, 'licenses_added', auth.uid(), jsonb_build_object('added', p_add, 'new_total', v_new));
    RETURN QUERY SELECT TRUE, NULL::INT;
  ELSE
    -- band crossed while active: pay the prorated difference first (12);
    -- the client takes this amount to the payment options and the licences
    -- land in settle_payment_intent when the money is confirmed
    RETURN QUERY SELECT FALSE, v_amount;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION request_license_increase(UUID, INT) TO authenticated;

-- ------------------------------------------------------------
-- 6. billing_tick — same cadence, zero paper. Amounts are computed for the
--    notice text; invoice_id stays in the signature and is always NULL.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing_tick()
RETURNS TABLE(subscription_id UUID, kind TEXT, ref TEXT, scope_name TEXT, billing_email TEXT,
              admin_user_ids UUID[], invoice_id UUID, amount_cents INT, date_ref DATE, license_count INT, plan TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE s RECORD;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'billing_tick is for the service role' USING ERRCODE = '42501';
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS _notices (subscription_id UUID, kind TEXT, ref TEXT, invoice_id UUID, date_ref DATE) ON COMMIT DROP;
  DELETE FROM _notices;

  FOR s IN SELECT * FROM subscriptions WHERE status <> 'cancelled' LOOP
    IF s.status = 'trial' THEN
      IF s.trial_ends_at::date - CURRENT_DATE = billing_days('renew_notice') THEN
        INSERT INTO _notices VALUES (s.id, 'trial_7', s.trial_ends_at::date::text, NULL, s.trial_ends_at::date); END IF;
      IF s.trial_ends_at::date - CURRENT_DATE = 1 THEN
        INSERT INTO _notices VALUES (s.id, 'trial_1', s.trial_ends_at::date::text, NULL, s.trial_ends_at::date); END IF;
      IF s.trial_ends_at <= now() THEN
        IF s.cancel_at_period_end THEN
          UPDATE subscriptions SET status = 'cancelled' WHERE id = s.id;
          INSERT INTO _notices VALUES (s.id, 'cancelled', 'trial', NULL, CURRENT_DATE);
        ELSE
          UPDATE subscriptions SET status = 'grace', grace_ends_at = now() + (billing_days('grace') || ' days')::interval WHERE id = s.id;
          INSERT INTO _notices VALUES (s.id, 'trial_ended', s.trial_ends_at::date::text, NULL, CURRENT_DATE + billing_days('grace'));
        END IF;
      END IF;
    END IF;

    IF s.status = 'active' AND s.current_period_end IS NOT NULL THEN
      IF s.current_period_end - CURRENT_DATE = billing_days('renew_notice') THEN
        IF s.cancel_at_period_end THEN
          INSERT INTO _notices VALUES (s.id, 'ending_7', s.current_period_end::text, NULL, s.current_period_end);
        ELSE
          INSERT INTO _notices VALUES (s.id, CASE WHEN s.auto_renew THEN 'autorenew_7' ELSE 'renewal_7' END, s.current_period_end::text, NULL, s.current_period_end);
        END IF;
      END IF;
      IF s.current_period_end < CURRENT_DATE THEN
        IF s.cancel_at_period_end THEN
          UPDATE subscriptions SET status = 'cancelled' WHERE id = s.id;
          INSERT INTO _notices VALUES (s.id, 'cancelled', s.current_period_end::text, NULL, s.current_period_end);
        ELSE
          -- 0116: no grace on renewals — locked directly, unlocked by renewing
          UPDATE subscriptions SET status = 'locked', locked_at = now() WHERE id = s.id;
          INSERT INTO _notices VALUES (s.id, 'locked', s.current_period_end::text, NULL, CURRENT_DATE);
        END IF;
      END IF;
    END IF;

    IF s.status = 'grace' AND s.grace_ends_at <= now() THEN
      UPDATE subscriptions SET status = 'locked', locked_at = now() WHERE id = s.id;
      INSERT INTO _notices VALUES (s.id, 'locked', COALESCE(s.grace_ends_at::date::text, ''), NULL, CURRENT_DATE);
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT n.subscription_id, n.kind, n.ref,
    COALESCE(b.name, c.name, o.name, ''), sub.billing_email,
    ARRAY(SELECT DISTINCT g.user_id FROM grants g
          WHERE (g.expires_at IS NULL OR g.expires_at >= CURRENT_DATE) AND (
               (sub.scope_type = 'building' AND g.building_id = sub.building_id AND g.role = 'building_admin')
            OR (sub.scope_type = 'compound' AND g.compound_id = sub.compound_id AND g.role = 'compound_admin')
            OR (sub.scope_type = 'org' AND g.org_id = sub.org_id AND g.role = 'org_admin'))),
    NULL::UUID, subscription_price_cents(sub.id), n.date_ref, sub.license_count, sub.plan
  FROM _notices n
  JOIN subscriptions sub ON sub.id = n.subscription_id
  LEFT JOIN buildings b ON b.id = sub.building_id
  LEFT JOIN compounds c ON c.id = sub.compound_id
  LEFT JOIN organizations o ON o.id = sub.org_id
  WHERE NOT EXISTS (SELECT 1 FROM billing_notices bn WHERE bn.subscription_id = n.subscription_id AND bn.kind = n.kind AND bn.ref = n.ref);
END;
$$;
REVOKE ALL ON FUNCTION billing_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION billing_tick() TO service_role;

-- ------------------------------------------------------------
-- 7. Cleanup: in the pay-first world an OPEN invoice is a contradiction.
--    Every kept invoice is a receipt; the open ones are superseded paper.
-- ------------------------------------------------------------
UPDATE invoices
   SET status = 'void', notes = COALESCE(notes || ' · ', '') || 'superseded: pay-first (0117)'
 WHERE status = 'open';

COMMIT;

-- Post-run checks:
--   1. Subscribe flow issues NOTHING: choose a cycle in the app → no invoice
--      row appears; only after settle_payment_intent does a PAID one exist.
--   2. select create_payment_intent('<sub>', 'period', 'monthly');
--      → one pending intent with the right amount/dates; calling again with
--      the same parameters returns the SAME intent (resume, not duplicate).
--   3. As service role: select settle_payment_intent('<intent>', 'whish', 'T1');
--      → invoice created status 'paid', subscription active with the intent's
--      period; calling again returns the same invoice id (idempotent).
--   4. Active sub, add licences across a band → request_license_increase
--      returns (false, <prorated cents>) and license_count is UNCHANGED;
--      settle a topup intent for it → licences land, paid topup receipt.
--   5. select billing_tick();  (as service role)  → notices carry computed
--      amount_cents, invoice_id NULL, and invoices table gained no rows.
--   6. SELECT count(*) FROM invoices WHERE status = 'open';  → 0.
