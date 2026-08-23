-- ============================================================
-- 0116_billing_polish.sql
-- The billing review round (Jey, 23 Aug 2026, items 1/7/10/12/13/14).
--
-- 1  NO CAPS. The 50/250/2500 licence caps are gone for every scope. The
--    guard keeps only what still matters: cap_override stays operator-only
--    (harmless legacy), and licences never drop below units/assignments.
--
-- 13 SUBSCRIBING DURDING THE TRIAL DOES NOT CUT IT SHORT. start_subscription
--    from a live trial starts the paid period the day AFTER the trial ends;
--    the invoice is issued now, payable now, and the trial runs its course.
--
-- 7/14  ONE INVOICE, ALWAYS CURRENT. Clicking subscribe repeatedly returned
--    the same-day invoice, but a plan change did not refresh it. Now an open
--    period invoice that no longer matches the plan/price is VOIDED and
--    reissued. The client no longer has an "issue invoice" step at all: pick
--    the cycle → the invoice exists → pay it, one motion.
--
-- 10/12  LICENCES THAT CROSS A BAND ARE HELD UNTIL PAID. The automatic
--    top-up trigger is replaced by request_license_increase(): in trial it
--    just adds; while paid and inside the band it just adds; while paid and
--    crossing a band UP it issues the prorated top-up invoice and DOES NOT
--    add the licences — mark_invoice_paid() applies them when it settles.
--
-- 12 GRACE IS FOR THE TRIAL ONLY. An unpaid renewal locks at period end,
--    directly. (Trial end keeps its 7-day grace.)
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Caps removed; floor kept
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION subscriptions_cap_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_units INT; v_assigned INT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF is_platform_admin() THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.cap_override IS DISTINCT FROM OLD.cap_override THEN
    RAISE EXCEPTION 'Only the platform operator can change the license cap override.' USING ERRCODE = '42501';
  END IF;
  -- no upper cap any more (0116); the floor still holds
  IF TG_OP = 'UPDATE' AND NEW.license_count < OLD.license_count THEN
    v_units := subscription_unit_count(NEW.id);
    SELECT count(*) INTO v_assigned FROM license_assignments WHERE subscription_id = NEW.id AND unassigned_at IS NULL;
    IF NEW.status <> 'trial' AND NEW.license_count < GREATEST(v_units, v_assigned) THEN
      RAISE EXCEPTION 'LICENSE_FLOOR: you hold % units and % assigned licences; remove units or unassign first.', v_units, v_assigned
        USING ERRCODE = 'P0003';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 2. Subscribe: trial keeps running; the open invoice always matches
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION start_subscription(p_subscription UUID, p_plan TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sub RECORD; v_start DATE; v_price INT; v_open RECORD;
BEGIN
  IF NOT user_manages_subscription(p_subscription) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription FOR UPDATE;
  IF v_sub.status = 'cancelled' THEN RAISE EXCEPTION 'This subscription is cancelled.' USING ERRCODE = '22023'; END IF;
  IF p_plan IS NOT NULL AND p_plan IN ('monthly','annual') AND p_plan <> v_sub.plan THEN
    UPDATE subscriptions SET plan = p_plan WHERE id = p_subscription;
  END IF;
  -- a live trial is not cut short: the paid period starts when it ends (13)
  v_start := CASE
    WHEN v_sub.status = 'trial' AND v_sub.trial_ends_at > now() THEN (v_sub.trial_ends_at::date + 1)
    WHEN v_sub.status = 'active' AND v_sub.current_period_end >= CURRENT_DATE THEN v_sub.current_period_end + 1
    ELSE CURRENT_DATE END;
  UPDATE subscriptions SET cancel_at_period_end = FALSE, cancelled_at = NULL WHERE id = p_subscription;
  -- one open period invoice, always matching today's plan and licences (7/14):
  -- void any that drifted, keep one that still matches
  v_price := subscription_price_cents(p_subscription);
  IF v_price IS NULL THEN
    RAISE EXCEPTION 'This subscription is priced by agreement — the Abniyah team issues its invoices.' USING ERRCODE = 'P0005';
  END IF;
  FOR v_open IN SELECT * FROM invoices WHERE subscription_id = p_subscription AND kind = 'period' AND status = 'open' LOOP
    IF v_open.period_start = v_start AND v_open.amount_cents = v_price THEN
      RETURN v_open.id;
    END IF;
    UPDATE invoices SET status = 'void', notes = COALESCE(notes || ' · ', '') || 'superseded by a new subscribe choice' WHERE id = v_open.id;
  END LOOP;
  RETURN issue_period_invoice(p_subscription, v_start);
END;
$$;
GRANT EXECUTE ON FUNCTION start_subscription(UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 3. Licence increases: held until paid when they cross a band (10/12)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS subscription_topup_trg ON subscriptions;

CREATE OR REPLACE FUNCTION request_license_increase(p_subscription UUID, p_add INT)
RETURNS TABLE(applied BOOLEAN, invoice_id UUID) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sub RECORD; v_new INT; v_old_m INT; v_new_m INT; v_inv UUID;
BEGIN
  IF NOT user_manages_subscription(p_subscription) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  IF p_add IS NULL OR p_add < 1 THEN RAISE EXCEPTION 'Nothing to add.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription FOR UPDATE;
  v_new := v_sub.license_count + p_add;
  -- trial, non-active states, negotiated pricing, or no band change: just add
  v_old_m := monthly_price_cents(v_sub.license_count); v_new_m := monthly_price_cents(v_new);
  IF v_sub.status <> 'active' OR v_sub.price_monthly_cents IS NOT NULL
     OR v_old_m IS NULL OR v_new_m IS NULL OR v_new_m <= v_old_m THEN
    UPDATE subscriptions SET license_count = v_new WHERE id = p_subscription;
    INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
    VALUES (p_subscription, 'licenses_added', auth.uid(), jsonb_build_object('added', p_add, 'new_total', v_new));
    RETURN QUERY SELECT TRUE, NULL::uuid;
    RETURN;
  END IF;
  -- band rises while paid: the top-up is paid FIRST; the licences follow the
  -- payment (mark_invoice_paid applies invoice.license_count for topups)
  SELECT id INTO v_inv FROM invoices
   WHERE subscription_id = p_subscription AND kind = 'topup' AND status = 'open' AND license_count = v_new;
  IF v_inv IS NULL THEN
    -- replace any stale pending top-up with the current choice
    UPDATE invoices SET status = 'void', notes = COALESCE(notes || ' · ', '') || 'superseded by a new licence choice'
     WHERE subscription_id = p_subscription AND kind = 'topup' AND status = 'open';
    v_inv := issue_topup_invoice(p_subscription, v_sub.license_count, v_new);
  END IF;
  RETURN QUERY SELECT FALSE, v_inv;
END;
$$;
GRANT EXECUTE ON FUNCTION request_license_increase(UUID, INT) TO authenticated;

-- settling a top-up now APPLIES the licences it bought
CREATE OR REPLACE FUNCTION mark_invoice_paid(p_invoice UUID, p_method TEXT DEFAULT 'manual', p_ref TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_inv RECORD; v_role TEXT := current_setting('request.jwt.claim.role', true);
BEGIN
  IF NOT (is_platform_admin() OR v_role = 'service_role' OR current_user = 'service_role') THEN
    RAISE EXCEPTION 'Not allowed to settle invoices.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_inv FROM invoices WHERE id = p_invoice FOR UPDATE;
  IF v_inv IS NULL THEN RAISE EXCEPTION 'Invoice not found.' USING ERRCODE = '22023'; END IF;
  IF v_inv.status = 'void' THEN RAISE EXCEPTION 'That invoice was voided — it cannot be settled.' USING ERRCODE = '22023'; END IF;
  IF v_inv.status = 'paid' THEN RETURN FALSE; END IF;
  UPDATE invoices SET status = 'paid', paid_at = now(), paid_by = auth.uid(),
         payment_method = COALESCE(p_method, 'manual'), payment_ref = p_ref
   WHERE id = p_invoice;
  IF v_inv.kind = 'period' THEN
    UPDATE subscriptions
       SET status = 'active', current_period_start = v_inv.period_start, current_period_end = v_inv.period_end,
           grace_ends_at = NULL, locked_at = NULL, trial_ends_at = NULL,
           license_count = GREATEST(license_count, COALESCE(v_inv.license_count, 0)),
           payment_provider = COALESCE(CASE WHEN p_method IN ('whish','areeba') THEN p_method END, payment_provider)
     WHERE id = v_inv.subscription_id;
  ELSE
    UPDATE subscriptions SET grace_ends_at = NULL, locked_at = NULL,
           status = CASE WHEN status IN ('grace','locked','past_due') THEN 'active' ELSE status END,
           license_count = GREATEST(license_count, COALESCE(v_inv.license_count, 0)),   -- 0116: the held licences land
           payment_provider = COALESCE(CASE WHEN p_method IN ('whish','areeba') THEN p_method END, payment_provider)
     WHERE id = v_inv.subscription_id;
    INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
    VALUES (v_inv.subscription_id, 'licenses_added', auth.uid(),
            jsonb_build_object('via', 'topup_paid', 'new_total', v_inv.license_count));
  END IF;
  INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
  VALUES (v_inv.subscription_id, 'invoice_paid', auth.uid(),
          jsonb_build_object('invoice_id', p_invoice, 'amount_cents', v_inv.amount_cents, 'method', COALESCE(p_method,'manual'), 'ref', p_ref, 'kind', v_inv.kind));
  RETURN TRUE;
END;
$$;

-- ------------------------------------------------------------
-- 4. Grace is trial-only: an unpaid renewal locks at period end (12)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing_tick()
RETURNS TABLE(subscription_id UUID, kind TEXT, ref TEXT, scope_name TEXT, billing_email TEXT,
              admin_user_ids UUID[], invoice_id UUID, amount_cents INT, date_ref DATE, license_count INT, plan TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE s RECORD; v_inv UUID;
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
          v_inv := issue_period_invoice(s.id, CURRENT_DATE);
          INSERT INTO _notices VALUES (s.id, 'trial_ended', s.trial_ends_at::date::text, v_inv, CURRENT_DATE + billing_days('grace'));
        END IF;
      END IF;
    END IF;

    IF s.status = 'active' AND s.current_period_end IS NOT NULL THEN
      IF s.current_period_end - CURRENT_DATE = billing_days('renew_notice') THEN
        IF s.cancel_at_period_end THEN
          INSERT INTO _notices VALUES (s.id, 'ending_7', s.current_period_end::text, NULL, s.current_period_end);
        ELSE
          v_inv := issue_period_invoice(s.id, s.current_period_end + 1);
          INSERT INTO _notices VALUES (s.id, CASE WHEN s.auto_renew THEN 'autorenew_7' ELSE 'renewal_7' END, s.current_period_end::text, v_inv, s.current_period_end);
        END IF;
      END IF;
      IF s.current_period_end < CURRENT_DATE THEN
        IF s.cancel_at_period_end THEN
          UPDATE subscriptions SET status = 'cancelled' WHERE id = s.id;
          INSERT INTO _notices VALUES (s.id, 'cancelled', s.current_period_end::text, NULL, s.current_period_end);
        ELSE
          -- 0116: no grace on renewals — locked directly, unlocked by payment
          v_inv := issue_period_invoice(s.id, s.current_period_end + 1);
          UPDATE subscriptions SET status = 'locked', locked_at = now() WHERE id = s.id;
          INSERT INTO _notices VALUES (s.id, 'locked', s.current_period_end::text, v_inv, CURRENT_DATE);
        END IF;
      END IF;
    END IF;

    IF s.status = 'grace' AND s.grace_ends_at <= now() THEN
      UPDATE subscriptions SET status = 'locked', locked_at = now() WHERE id = s.id;
      SELECT id INTO v_inv FROM invoices WHERE subscription_id = s.id AND status = 'open' AND kind = 'period' ORDER BY created_at DESC LIMIT 1;
      INSERT INTO _notices VALUES (s.id, 'locked', COALESCE(s.grace_ends_at::date::text, ''), v_inv, CURRENT_DATE);
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
    n.invoice_id, i.amount_cents, n.date_ref, sub.license_count, sub.plan
  FROM _notices n
  JOIN subscriptions sub ON sub.id = n.subscription_id
  LEFT JOIN buildings b ON b.id = sub.building_id
  LEFT JOIN compounds c ON c.id = sub.compound_id
  LEFT JOIN organizations o ON o.id = sub.org_id
  LEFT JOIN invoices i ON i.id = n.invoice_id
  WHERE NOT EXISTS (SELECT 1 FROM billing_notices bn WHERE bn.subscription_id = n.subscription_id AND bn.kind = n.kind AND bn.ref = n.ref);
END;
$$;
REVOKE ALL ON FUNCTION billing_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION billing_tick() TO service_role;

COMMIT;

-- Post-run checks:
--   1. Trial: add 500 licences → accepted (no cap, any scope).
--   2. Trial: Subscribe → invoice period starts the day after trial_ends_at;
--      click again with the other plan → the first invoice is void, one open
--      invoice remains, amount matches the new plan.
--   3. Set a test sub active (pay the invoice): add licences within the band →
--      applied at once. Add licences crossing a band → applied=false, a topup
--      invoice returned, license_count unchanged; mark it paid →
--      license_count jumps to the invoice's count.
--   4. Active sub with current_period_end = yesterday: billing_tick() → status
--      'locked' (no grace), a renewal invoice open; pay → active again.
