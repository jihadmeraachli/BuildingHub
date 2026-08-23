-- ============================================================
-- 0114_billing_lifecycle.sql
-- A subscription that starts, renews, lapses and ends on its own.
--
-- BEFORE. 30-day trial at signup, then nothing: status stayed 'trial' with a
-- past date, residents were locked out, the admin saw no change, and every
-- invoice was typed by hand by the platform operator. Licences did not bound
-- units, and the price was computed from units that exist, so an empty trial
-- building priced at the bottom band whatever it had bought.
--
-- THE RULES (Jey, 23 Aug 2026)
--   Price     the band for LICENCES BOUGHT (32 → 21-40 → $105/mo). A
--             negotiated price_monthly_cents still wins.
--   Units     a scope can never hold more active units than licences, once
--             out of trial. Creating/importing the 33rd unit on 32 licences is
--             refused HERE, with a message the client recognises.
--   Trial     30 days, unlimited licences, no card.
--   Grace     trial or period ends unpaid → 'grace' for 7 days: banner and
--             emails, everything works. Then 'locked': admin read-only except
--             billing, residents locked, until an invoice is paid.
--   Top-up    adding licences that crosses a band UP while active → a
--             prorated top-up invoice for the remaining days of the period at
--             the band difference, due in 7 days.
--   Reduce    removing licences never refunds; the lower band applies from
--             the next period. Never below units or assignments.
--   Renewal   an invoice is issued 7 days before period end. Auto-renew (a
--             stored card at the provider) is charged by the cron; otherwise
--             the admin pays it. Unpaid at period end → grace → locked.
--   Cancel    at end of the paid period (or trial); no refund; reversible
--             until then.
--
-- WHO DOES WHAT
--   billing_tick()           the morning cron: state transitions + the list
--                            of notices to send (dedup'd in billing_notices).
--   start_subscription()     "Subscribe / Renew now": issues the invoice.
--   cancel/resume_subscription(), set_auto_renew()  the admin's buttons.
--   mark_invoice_paid()      the gateways (and the operator) settle here;
--                            it now also clears grace/locked.
--   user_can()               returns FALSE for write capabilities while the
--                            building's subscription is locked. Billing
--                            policies use user_can_unlocked() so the renewal
--                            page stays writable — that is the whole point.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Columns and statuses
-- ------------------------------------------------------------
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('trial','active','grace','locked','past_due','cancelled'));

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS auto_renew           BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancelled_at         TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS grace_ends_at        TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS locked_at            TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_provider     TEXT CHECK (payment_provider IS NULL OR payment_provider IN ('whish','areeba'));
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_customer_ref TEXT;   -- Areeba customer / stored-card reference, never a PAN
COMMENT ON COLUMN subscriptions.provider_customer_ref IS 'Gateway reference to a stored payment method (token). Needed for auto_renew. Never card data.';

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS kind        TEXT NOT NULL DEFAULT 'period' CHECK (kind IN ('period','topup'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date    DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS license_count INT;

-- the morning cron's memory: which notice went out for which subscription
CREATE TABLE IF NOT EXISTS billing_notices (
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  ref             TEXT NOT NULL DEFAULT '',   -- period end / invoice id, so the same kind can recur per period
  sent_on         DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (subscription_id, kind, ref)
);
ALTER TABLE billing_notices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_notices_platform ON billing_notices;
CREATE POLICY billing_notices_platform ON billing_notices FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- the lifecycle numbers, in one place
CREATE OR REPLACE FUNCTION billing_days(p_key TEXT) RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_key
    WHEN 'trial'        THEN 30
    WHEN 'grace'        THEN 7
    WHEN 'invoice_due'  THEN 7
    WHEN 'renew_notice' THEN 7
    ELSE 0 END;
$$;

-- ------------------------------------------------------------
-- 2. Price by licences bought (replaces 0100's units-based price)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION subscription_monthly_cents(p_subscription UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(s.price_monthly_cents, monthly_price_cents(s.license_count))
  FROM subscriptions s WHERE s.id = p_subscription;
$$;

CREATE OR REPLACE FUNCTION subscription_price_cents(p_subscription UUID)
RETURNS INTEGER LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_plan TEXT; v_monthly INT;
BEGIN
  SELECT plan INTO v_plan FROM subscriptions WHERE id = p_subscription;
  v_monthly := subscription_monthly_cents(p_subscription);
  IF v_monthly IS NULL THEN RETURN NULL; END IF;          -- negotiated, not priced
  RETURN CASE WHEN v_plan = 'annual' THEN v_monthly * 10 ELSE v_monthly END;
END;
$$;
GRANT EXECUTE ON FUNCTION subscription_monthly_cents(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION subscription_price_cents(UUID) TO authenticated;

-- units currently in a subscription's scope
CREATE OR REPLACE FUNCTION subscription_unit_count(p_subscription UUID)
RETURNS INTEGER LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_sub RECORD; n INT;
BEGIN
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription;
  IF v_sub IS NULL THEN RETURN 0; END IF;
  IF v_sub.scope_type = 'building' THEN
    SELECT count(*) INTO n FROM units WHERE building_id = v_sub.building_id;
  ELSIF v_sub.scope_type = 'compound' THEN
    SELECT count(*) INTO n FROM units u JOIN buildings b ON b.id = u.building_id WHERE b.compound_id = v_sub.compound_id;
  ELSE
    SELECT count(*) INTO n FROM units u JOIN org_buildings ob ON ob.building_id = u.building_id WHERE ob.org_id = v_sub.org_id;
  END IF;
  RETURN n;
END;
$$;
GRANT EXECUTE ON FUNCTION subscription_unit_count(UUID) TO authenticated;

-- the subscription a building lives under (building → compound → org)
CREATE OR REPLACE FUNCTION building_subscription_id(p_building UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT s.id FROM subscriptions s
  WHERE s.status <> 'cancelled' AND (
       (s.scope_type = 'building' AND s.building_id = p_building)
    OR (s.scope_type = 'compound' AND s.compound_id = (SELECT compound_id FROM buildings WHERE id = p_building))
    OR (s.scope_type = 'org' AND EXISTS (SELECT 1 FROM org_buildings ob WHERE ob.building_id = p_building AND ob.org_id = s.org_id)))
  ORDER BY CASE s.scope_type WHEN 'building' THEN 0 WHEN 'compound' THEN 1 ELSE 2 END
  LIMIT 1;
$$;

-- ------------------------------------------------------------
-- 3. Units never exceed licences (outside the trial)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_units_within_licenses() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sub RECORD; n INT;
BEGIN
  IF auth.uid() IS NOT NULL AND is_platform_admin() THEN RETURN NEW; END IF;
  SELECT * INTO v_sub FROM subscriptions WHERE id = building_subscription_id(NEW.building_id);
  IF v_sub IS NULL OR v_sub.status = 'trial' THEN RETURN NEW; END IF;
  n := subscription_unit_count(v_sub.id);
  IF n > v_sub.license_count THEN
    -- the client matches on the prefix and offers the Add licences page
    RAISE EXCEPTION 'LICENSE_LIMIT: this subscription has % licences and already holds % units. Add licences to add more units.',
      v_sub.license_count, n - 1 USING ERRCODE = 'P0003';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS units_within_licenses ON units;
CREATE TRIGGER units_within_licenses AFTER INSERT OR UPDATE OF building_id ON units
  FOR EACH ROW EXECUTE FUNCTION trg_units_within_licenses();

-- ------------------------------------------------------------
-- 4. Guards: trial is uncapped; licences never below units or assignments;
--    the lifecycle columns are the operator's and the cron's
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION subscriptions_cap_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE eff_cap INTEGER; v_units INT; v_assigned INT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF is_platform_admin() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.cap_override IS NOT NULL THEN
    RAISE EXCEPTION 'Only the platform operator can set a license cap override.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.cap_override IS DISTINCT FROM OLD.cap_override THEN
    RAISE EXCEPTION 'Only the platform operator can change the license cap override.' USING ERRCODE = '42501';
  END IF;
  -- the trial is uncapped (0114): the cap is a paid-account hygiene rule
  IF NEW.status <> 'trial' THEN
    eff_cap := COALESCE(NEW.cap_override, license_cap(NEW.scope_type));
    IF NEW.license_count > eff_cap THEN
      RAISE EXCEPTION 'License limit for this account type is % units. Contact the Abniyah team if you manage more.', eff_cap
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- never fewer licences than units held or licences assigned
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

CREATE OR REPLACE FUNCTION subscriptions_column_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL OR is_platform_admin() THEN RETURN NEW; END IF;
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
    RAISE EXCEPTION 'Billing fields are managed by the Abniyah team — contact support.'
      USING ERRCODE = '42501';
  END IF;
  -- plan may change only between periods (it is applied at the next invoice);
  -- auto_renew needs a stored payment method
  IF NEW.auto_renew AND NOT OLD.auto_renew AND NEW.provider_customer_ref IS NULL THEN
    RAISE EXCEPTION 'Save a card first to turn on auto-renew.' USING ERRCODE = 'P0004';
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 5. Invoices: period and top-up
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION period_end_for(p_plan TEXT, p_start DATE) RETURNS DATE
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_plan = 'annual' THEN (p_start + INTERVAL '1 year')::date - 1
              ELSE (p_start + INTERVAL '1 month')::date - 1 END;
$$;

-- One open period invoice at a time. Returns the invoice id (existing or new).
CREATE OR REPLACE FUNCTION issue_period_invoice(p_subscription UUID, p_period_start DATE)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sub RECORD; v_amount INT; v_end DATE; v_id UUID;
BEGIN
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription FOR UPDATE;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'Subscription not found.' USING ERRCODE = '22023'; END IF;
  SELECT id INTO v_id FROM invoices
   WHERE subscription_id = p_subscription AND kind = 'period' AND status = 'open' AND period_start = p_period_start;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  v_amount := subscription_price_cents(p_subscription);
  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'This subscription is priced by agreement — the Abniyah team issues its invoices.' USING ERRCODE = 'P0005';
  END IF;
  v_end := period_end_for(v_sub.plan, p_period_start);
  INSERT INTO invoices (subscription_id, amount_cents, status, period_start, period_end, kind, due_date, license_count, description)
  VALUES (p_subscription, v_amount, 'open', p_period_start, v_end, 'period',
          LEAST(p_period_start, CURRENT_DATE) + billing_days('invoice_due'), v_sub.license_count,
          format('%s licences · %s', v_sub.license_count, v_sub.plan))
  RETURNING id INTO v_id;
  INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
  VALUES (p_subscription, 'invoice_issued', auth.uid(), jsonb_build_object('invoice_id', v_id, 'amount_cents', v_amount, 'kind', 'period'));
  RETURN v_id;
END;
$$;

-- Prorated by DAYS against the real period (this month's length, or 365).
CREATE OR REPLACE FUNCTION issue_topup_invoice(p_subscription UUID, p_old_count INT, p_new_count INT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sub RECORD; v_old INT; v_new INT; v_days INT; v_left INT; v_amount INT; v_id UUID; v_mult INT;
BEGIN
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription;
  IF v_sub IS NULL OR v_sub.status <> 'active' OR v_sub.current_period_end IS NULL THEN RETURN NULL; END IF;
  IF v_sub.price_monthly_cents IS NOT NULL THEN RETURN NULL; END IF;     -- negotiated: no automatic top-up
  v_old := monthly_price_cents(p_old_count); v_new := monthly_price_cents(p_new_count);
  IF v_old IS NULL OR v_new IS NULL OR v_new <= v_old THEN RETURN NULL; END IF;
  v_mult := CASE WHEN v_sub.plan = 'annual' THEN 10 ELSE 1 END;
  v_days := (v_sub.current_period_end - v_sub.current_period_start) + 1;
  v_left := GREATEST(0, v_sub.current_period_end - CURRENT_DATE + 1);
  v_amount := ROUND(((v_new - v_old) * v_mult)::numeric * v_left / v_days);
  IF v_amount < 100 THEN RETURN NULL; END IF;                              -- under a dollar: not worth an invoice
  INSERT INTO invoices (subscription_id, amount_cents, status, period_start, period_end, kind, due_date, license_count, description)
  VALUES (p_subscription, v_amount, 'open', CURRENT_DATE, v_sub.current_period_end, 'topup',
          CURRENT_DATE + billing_days('invoice_due'), p_new_count,
          format('Top-up: %s → %s licences, %s of %s days', p_old_count, p_new_count, v_left, v_days))
  RETURNING id INTO v_id;
  INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
  VALUES (p_subscription, 'invoice_issued', auth.uid(), jsonb_build_object('invoice_id', v_id, 'amount_cents', v_amount, 'kind', 'topup'));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION trg_subscription_topup() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.license_count > OLD.license_count AND NEW.status = 'active' THEN
    PERFORM issue_topup_invoice(NEW.id, OLD.license_count, NEW.license_count);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS subscription_topup_trg ON subscriptions;
CREATE TRIGGER subscription_topup_trg AFTER UPDATE OF license_count ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION trg_subscription_topup();

-- ------------------------------------------------------------
-- 5b. The lock gates (defined BEFORE the functions that reference them:
--     SQL function bodies are validated at CREATE time)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION subscription_locked_for(p_building UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE((SELECT status = 'locked' FROM subscriptions WHERE id = building_subscription_id(p_building)), FALSE);
$$;

CREATE OR REPLACE FUNCTION user_can_unlocked(p_building UUID, p_cap TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE r TEXT;
BEGIN
  IF is_platform_admin() THEN RETURN TRUE; END IF;
  FOR r IN
    SELECT g.role FROM grants g
    WHERE g.user_id = auth.uid()
      AND (g.expires_at IS NULL OR g.expires_at >= CURRENT_DATE)
      AND (
        (g.scope_type = 'building' AND g.building_id = p_building)
        OR (g.scope_type = 'compound' AND EXISTS (SELECT 1 FROM buildings b WHERE b.id = p_building AND b.compound_id = g.compound_id))
        OR (g.scope_type = 'org' AND EXISTS (SELECT 1 FROM org_buildings ob WHERE ob.org_id = g.org_id AND ob.building_id = p_building))
      )
  LOOP
    IF role_has_cap(r, p_cap) THEN RETURN TRUE; END IF;
  END LOOP;
  RETURN FALSE;
END;
$$;
GRANT EXECUTE ON FUNCTION user_can_unlocked(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION user_can(p_building UUID, p_cap TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF is_platform_admin() THEN RETURN TRUE; END IF;
  IF NOT user_can_unlocked(p_building, p_cap) THEN RETURN FALSE; END IF;
  -- locked: reading is fine, everything else waits for the invoice
  IF p_cap NOT IN ('finance.view', 'issue.view_all') AND subscription_locked_for(p_building) THEN
    RETURN FALSE;
  END IF;
  RETURN TRUE;
END;
$$;


-- ------------------------------------------------------------
-- 6. The admin's buttons
-- ------------------------------------------------------------
-- who may run them: the scope's managing admin (through the UNLOCKED check,
-- since a locked account must be able to pay)
CREATE OR REPLACE FUNCTION user_manages_subscription(p_subscription UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT is_platform_admin() OR EXISTS (
    SELECT 1 FROM subscriptions s
    WHERE s.id = p_subscription AND (
         (s.scope_type = 'building' AND user_can_unlocked(s.building_id, 'building.manage'))
      OR (s.scope_type = 'compound' AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
            AND g.scope_type = 'compound' AND g.compound_id = s.compound_id AND g.role = 'compound_admin'
            AND (g.expires_at IS NULL OR g.expires_at >= CURRENT_DATE)))
      OR (s.scope_type = 'org' AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
            AND g.scope_type = 'org' AND g.org_id = s.org_id AND g.role = 'org_admin'
            AND (g.expires_at IS NULL OR g.expires_at >= CURRENT_DATE)))));
$$;

-- Subscribe / Renew now. From trial, grace or locked: the first period starts
-- today. From active: the next period, starting at the current period end.
CREATE OR REPLACE FUNCTION start_subscription(p_subscription UUID, p_plan TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sub RECORD; v_start DATE;
BEGIN
  IF NOT user_manages_subscription(p_subscription) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
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
GRANT EXECUTE ON FUNCTION start_subscription(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION cancel_subscription(p_subscription UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT user_manages_subscription(p_subscription) THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  UPDATE subscriptions SET cancel_at_period_end = TRUE, cancelled_at = now(), auto_renew = FALSE WHERE id = p_subscription;
  INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
  VALUES (p_subscription, 'cancel_requested', auth.uid(), '{}'::jsonb);
END;
$$;
CREATE OR REPLACE FUNCTION resume_subscription(p_subscription UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT user_manages_subscription(p_subscription) THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  UPDATE subscriptions SET cancel_at_period_end = FALSE, cancelled_at = NULL WHERE id = p_subscription AND status <> 'cancelled';
  INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
  VALUES (p_subscription, 'cancel_withdrawn', auth.uid(), '{}'::jsonb);
END;
$$;
CREATE OR REPLACE FUNCTION set_auto_renew(p_subscription UUID, p_on BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_ref TEXT;
BEGIN
  IF NOT user_manages_subscription(p_subscription) THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  SELECT provider_customer_ref INTO v_ref FROM subscriptions WHERE id = p_subscription;
  IF p_on AND v_ref IS NULL THEN
    RAISE EXCEPTION 'Save a card first to turn on auto-renew.' USING ERRCODE = 'P0004';
  END IF;
  UPDATE subscriptions SET auto_renew = p_on WHERE id = p_subscription;
  INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
  VALUES (p_subscription, CASE WHEN p_on THEN 'auto_renew_on' ELSE 'auto_renew_off' END, auth.uid(), '{}'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION cancel_subscription(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION resume_subscription(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION set_auto_renew(UUID, BOOLEAN) TO authenticated;

-- the audit guard learns the new self-service events
CREATE OR REPLACE FUNCTION subscription_events_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL OR is_platform_admin() THEN RETURN NEW; END IF;
  NEW.actor_id := auth.uid();
  IF NEW.event_type NOT IN ('license_assigned','license_unassigned','licenses_added','licenses_removed',
                            'invoice_issued','cancel_requested','cancel_withdrawn','auto_renew_on','auto_renew_off') THEN
    RAISE EXCEPTION 'Invalid event type for this account.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 7. Settling an invoice clears grace and lock
-- ------------------------------------------------------------
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
           status = CASE WHEN status IN ('grace','locked','past_due') THEN 'active' ELSE status END
     WHERE id = v_inv.subscription_id;
  END IF;
  INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
  VALUES (v_inv.subscription_id, 'invoice_paid', auth.uid(),
          jsonb_build_object('invoice_id', p_invoice, 'amount_cents', v_inv.amount_cents, 'method', COALESCE(p_method,'manual'), 'ref', p_ref, 'kind', v_inv.kind));
  RETURN TRUE;
END;
$$;

-- ------------------------------------------------------------
-- 8. Billing policies route through user_can_unlocked() so the renewal
--    page stays writable while locked (the gates are in 5b).
-- ------------------------------------------------------------
-- billing tables: the building branch goes through the unlocked check
DROP POLICY IF EXISTS "subscriptions_read_scope_admin" ON subscriptions;
CREATE POLICY "subscriptions_read_scope_admin" ON subscriptions FOR SELECT TO authenticated USING (
  (scope_type = 'building' AND user_can_unlocked(building_id, 'finance.view'))
  OR (scope_type = 'compound' AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = auth.uid() AND g.scope_type = 'compound' AND g.compound_id = subscriptions.compound_id))
  OR (scope_type = 'org' AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = auth.uid() AND g.scope_type = 'org' AND g.org_id = subscriptions.org_id))
);
DROP POLICY IF EXISTS "subscriptions_update_scope_admin" ON subscriptions;
CREATE POLICY "subscriptions_update_scope_admin" ON subscriptions FOR UPDATE TO authenticated
  USING (user_manages_subscription(id)) WITH CHECK (user_manages_subscription(id));
DROP POLICY IF EXISTS "invoices_read_scope_admin" ON invoices;
CREATE POLICY "invoices_read_scope_admin" ON invoices FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM subscriptions s WHERE s.id = invoices.subscription_id AND (
       (s.scope_type = 'building' AND user_can_unlocked(s.building_id, 'finance.view'))
    OR (s.scope_type = 'compound' AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = auth.uid() AND g.scope_type = 'compound' AND g.compound_id = s.compound_id))
    OR (s.scope_type = 'org' AND EXISTS (SELECT 1 FROM grants g WHERE g.user_id = auth.uid() AND g.scope_type = 'org' AND g.org_id = s.org_id))))
);

-- residents: grace keeps them in, locked keeps them out
CREATE OR REPLACE FUNCTION unit_has_active_license(p_unit_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM license_assignments la JOIN subscriptions s ON s.id = la.subscription_id
    WHERE la.unit_id = p_unit_id AND la.unassigned_at IS NULL
      AND (s.status IN ('active','grace') OR (s.status = 'trial' AND s.trial_ends_at > now()))
  );
$$;

-- ------------------------------------------------------------
-- 9. The morning tick: transitions, renewal invoices, and what to tell whom
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing_tick()
RETURNS TABLE(subscription_id UUID, kind TEXT, ref TEXT, scope_name TEXT, billing_email TEXT,
              admin_user_ids UUID[], invoice_id UUID, amount_cents INT, date_ref DATE, license_count INT, plan TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE s RECORD; v_inv UUID; v_due DATE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'billing_tick is for the service role' USING ERRCODE = '42501';
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS _notices (subscription_id UUID, kind TEXT, ref TEXT, invoice_id UUID, date_ref DATE) ON COMMIT DROP;
  DELETE FROM _notices;

  FOR s IN SELECT * FROM subscriptions WHERE status <> 'cancelled' LOOP
    -- trial countdown and end
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

    -- paid period: warn, invoice, and at the end either renew or lapse
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
          -- the renewal invoice was not paid (auto-renew charges happen before this, in the cron)
          v_inv := issue_period_invoice(s.id, s.current_period_end + 1);
          UPDATE subscriptions SET status = 'grace', grace_ends_at = now() + (billing_days('grace') || ' days')::interval WHERE id = s.id;
          INSERT INTO _notices VALUES (s.id, 'grace', s.current_period_end::text, v_inv, CURRENT_DATE + billing_days('grace'));
        END IF;
      END IF;
    END IF;

    -- grace runs out
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

-- the cron records what it sent
CREATE OR REPLACE FUNCTION billing_notice_sent(p_subscription UUID, p_kind TEXT, p_ref TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO billing_notices (subscription_id, kind, ref) VALUES (p_subscription, p_kind, p_ref) ON CONFLICT DO NOTHING;
$$;
REVOKE ALL ON FUNCTION billing_notice_sent(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION billing_notice_sent(UUID, TEXT, TEXT) TO service_role;

-- subscriptions due an auto-renew charge: an open period invoice, a stored card
CREATE OR REPLACE FUNCTION autorenew_due()
RETURNS TABLE(subscription_id UUID, invoice_id UUID, amount_cents INT, provider TEXT, customer_ref TEXT)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT s.id, i.id, i.amount_cents, s.payment_provider, s.provider_customer_ref
  FROM subscriptions s JOIN invoices i ON i.subscription_id = s.id AND i.status = 'open' AND i.kind = 'period'
  WHERE s.auto_renew AND s.provider_customer_ref IS NOT NULL AND s.status IN ('active','grace')
    AND i.period_start <= CURRENT_DATE + 1;
$$;
REVOKE ALL ON FUNCTION autorenew_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION autorenew_due() TO service_role;

-- ------------------------------------------------------------
-- 10. get_building_subscription learns the new columns (Billing UI helper)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_building_subscription(UUID);
CREATE FUNCTION get_building_subscription(p_building_id UUID)
RETURNS TABLE (id UUID, scope_type TEXT, status TEXT, plan TEXT, trial_ends_at TIMESTAMPTZ,
               current_period_start DATE, current_period_end DATE, grace_ends_at TIMESTAMPTZ,
               license_count INT, assigned_count BIGINT, available_count BIGINT, unit_count INT,
               auto_renew BOOLEAN, cancel_at_period_end BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT s.id, s.scope_type, s.status, s.plan, s.trial_ends_at, s.current_period_start, s.current_period_end, s.grace_ends_at,
         s.license_count,
         COUNT(la.id) FILTER (WHERE la.unassigned_at IS NULL),
         GREATEST(0, s.license_count - COUNT(la.id) FILTER (WHERE la.unassigned_at IS NULL))::BIGINT,
         subscription_unit_count(s.id), s.auto_renew, s.cancel_at_period_end
  FROM subscriptions s LEFT JOIN license_assignments la ON la.subscription_id = s.id
  WHERE s.id = building_subscription_id(p_building_id)
  GROUP BY s.id;
$$;
GRANT EXECUTE ON FUNCTION get_building_subscription(UUID) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   1. As a trial admin: add 200 licences → accepted (trial is uncapped).
--      Create units up to the licence count, then one more → LICENSE_LIMIT
--      only AFTER the trial (set status='active' on a test row to see it).
--   2. Subscribe now → one open 'period' invoice, amount = band(licences),
--      due in 7 days. mark_invoice_paid(...) → status active, period set.
--   3. Active, monthly, 20 licences, mid-period: add 15 → a 'topup' invoice
--      for (105-85) × remaining/period days. Remove 15 → no invoice.
--   4. SELECT * FROM billing_tick();  (SQL Editor) — transitions a test row
--      whose trial_ends_at is yesterday into 'grace' and returns a
--      'trial_ended' notice; run again → nothing (billing_notices dedup needs
--      the cron to call billing_notice_sent; the editor run shows the row).
--   5. Set a test row to 'locked': as its admin, /finance is read-only and
--      Record expense is refused (42501); /licenses still loads and Subscribe
--      works. Pay → unlocked.
--   6. node scripts/rls-audit.mjs (billing_notices: platform only).
-- ============================================================
