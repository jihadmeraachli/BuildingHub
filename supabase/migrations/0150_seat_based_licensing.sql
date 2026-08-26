-- ============================================================
-- 0150_seat_based_licensing.sql
-- LICENSING MODEL CHANGE (Jey's call, 2026-08-26): units are free structure,
-- SEATS are what you pay for. Found while import-testing Bahloul: the old
-- unit-count cap blocked imports, counted soft-deleted units, and fought the
-- assignment model Structure already half-implemented.
--
--   OLD: units <= license_count enforced at unit creation (LICENSE_LIMIT).
--   NEW: create as many units as you like; assigning a licence SEAT to a unit
--        is the wall (DB-enforced now - it was client-side only), and renewal
--        money follows ASSIGNED seats, never raw unit counts.
--
-- The pieces:
--   1. subscription_unit_count excludes soft-deleted units (the 76-vs-67 bug).
--   2. The unit-creation cap trigger is DROPPED.
--   3. license_assignments_guard gains the real pool check:
--      LICENSE_POOL_EMPTY once assigned >= license_count (trial uncapped,
--      platform admin + service role bypass).
--   4. Trashing a unit RELEASES its seat (+ event) - so a restored unit always
--      comes back unlicensed and the pool stays conserved (Jey's rule).
--   5. The licence floor (cap guard + scheduled reductions) counts ASSIGNED
--      seats only - unit counts no longer block removing licences.
--   6. settle_payment_intent's renewal clamp drops the unit-count term -
--      renewal seats = max(scheduled/current licences, assigned, 1).
--
-- ⚠️ MONEY-ADJACENT and verified by analysis, not on live dues... er, seats:
--    exercise on Bahloul (delete->restore a licensed unit, renew) before trust.
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ── 1. Truthful unit counting (soft-deleted units are not held units) ─────
CREATE OR REPLACE FUNCTION subscription_unit_count(p_subscription UUID)
RETURNS INTEGER LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_sub RECORD; n INT;
BEGIN
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription;
  IF v_sub IS NULL THEN RETURN 0; END IF;
  IF v_sub.scope_type = 'building' THEN
    SELECT count(*) INTO n FROM units WHERE building_id = v_sub.building_id AND deleted_at IS NULL;
  ELSIF v_sub.scope_type = 'compound' THEN
    SELECT count(*) INTO n FROM units u JOIN buildings b ON b.id = u.building_id
     WHERE b.compound_id = v_sub.compound_id AND u.deleted_at IS NULL;
  ELSE
    SELECT count(*) INTO n FROM units u JOIN org_buildings ob ON ob.building_id = u.building_id
     WHERE ob.org_id = v_sub.org_id AND u.deleted_at IS NULL;
  END IF;
  RETURN n;
END;
$$;

-- ── 2. Units are no longer capped at creation ─────────────────────────────
DROP TRIGGER IF EXISTS units_within_licenses ON units;
DROP FUNCTION IF EXISTS trg_units_within_licenses();

-- ── 3. The seat pool is the wall, enforced in the database ────────────────
CREATE OR REPLACE FUNCTION license_assignments_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_ok BOOLEAN; v_sub RECORD; v_assigned INT;
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
    -- 0150: the pool check. Was client-side only - anyone with the API could
    -- assign past the licences paid for. Trial is uncapped (0114 spirit).
    IF auth.uid() IS NOT NULL AND NOT is_platform_admin() THEN
      SELECT * INTO v_sub FROM subscriptions WHERE id = NEW.subscription_id;
      SELECT count(*) INTO v_assigned FROM license_assignments
       WHERE subscription_id = NEW.subscription_id AND unassigned_at IS NULL;
      IF v_sub.status <> 'trial' AND v_assigned >= v_sub.license_count THEN
        RAISE EXCEPTION 'LICENSE_POOL_EMPTY: all % licences are assigned. Add licences to license more units.',
          v_sub.license_count USING ERRCODE = 'P0003';
      END IF;
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

-- ── 4. Trashing a unit releases its seat; restore returns unlicensed ──────
CREATE OR REPLACE FUNCTION units_release_seat_on_trash()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE r RECORD;
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    FOR r IN
      UPDATE license_assignments
         SET unassigned_at = now(), unassigned_by = auth.uid()
       WHERE unit_id = NEW.id AND unassigned_at IS NULL
      RETURNING subscription_id
    LOOP
      INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
      VALUES (r.subscription_id, 'license_unassigned', auth.uid(),
              jsonb_build_object('unit_id', NEW.id, 'unit_label', NEW.label, 'via', 'unit_trashed'));
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS units_release_seat_on_trash_trg ON units;
CREATE TRIGGER units_release_seat_on_trash_trg
  AFTER UPDATE OF deleted_at ON units
  FOR EACH ROW EXECUTE FUNCTION units_release_seat_on_trash();

-- ── 5a. Licence floor = assigned seats (cap guard; body is 0116's) ────────
CREATE OR REPLACE FUNCTION subscriptions_cap_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_assigned INT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF is_platform_admin() THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.cap_override IS DISTINCT FROM OLD.cap_override THEN
    RAISE EXCEPTION 'Only the platform operator can change the license cap override.' USING ERRCODE = '42501';
  END IF;
  -- 0150: the floor counts ASSIGNED seats, not raw units - units are free now.
  IF TG_OP = 'UPDATE' AND NEW.license_count < OLD.license_count THEN
    SELECT count(*) INTO v_assigned FROM license_assignments WHERE subscription_id = NEW.id AND unassigned_at IS NULL;
    IF NEW.status <> 'trial' AND NEW.license_count < GREATEST(1, v_assigned) THEN
      RAISE EXCEPTION 'LICENSE_FLOOR: % licences are assigned to units; unassign first.', v_assigned
        USING ERRCODE = 'P0003';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 5b. Scheduled reductions floor on assigned seats (body is 0134's) ─────
CREATE OR REPLACE FUNCTION schedule_license_reduction(p_subscription UUID, p_remove INT)
RETURNS TABLE(immediate BOOLEAN, new_count INT, effective_date DATE)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sub RECORD; v_target INT; v_assigned INT;
BEGIN
  IF NOT user_manages_subscription(p_subscription) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  IF p_remove IS NULL OR p_remove < 1 THEN RAISE EXCEPTION 'Nothing to remove.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription FOR UPDATE;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'Subscription not found.' USING ERRCODE = '22023'; END IF;

  v_target := COALESCE(v_sub.renews_license_count, v_sub.license_count) - p_remove;
  SELECT count(*) INTO v_assigned FROM license_assignments
   WHERE subscription_id = p_subscription AND unassigned_at IS NULL;
  IF v_target < GREATEST(1, v_assigned) THEN
    RAISE EXCEPTION 'LICENSE_FLOOR: % licences are assigned to units; unassign first.', v_assigned
      USING ERRCODE = 'P0003';
  END IF;

  IF v_sub.status = 'active' AND v_sub.current_period_end IS NOT NULL AND v_sub.current_period_end >= CURRENT_DATE THEN
    UPDATE subscriptions
       SET renews_license_count = CASE WHEN v_target = license_count THEN NULL ELSE v_target END
     WHERE id = p_subscription;
    -- 0134: the renewal price just changed - invalidate any open renewal link.
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

-- ── 6. Renewal seats = max(licences, assigned) - never raw units (0129 body)
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
    -- 0150: units are free structure; ASSIGNED seats are what renewals clamp to.
    v_count := GREATEST(v_count, v_assigned, 1);
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

-- Post-run checks (on Bahloul):
--   Import 30 units with a 20-seat pool -> all 30 created; 20 assigned, 10
--     marked "unlicensed (pool empty)"; no LICENSE_LIMIT anywhere.
--   Trash a LICENSED unit -> its seat frees instantly (pool +1, event logged);
--     restore it -> unit is back, UNLICENSED, pool untouched.
--   As a non-admin API call: insert a license_assignment past the pool ->
--     LICENSE_POOL_EMPTY.
--   Remove licences below the assigned count -> LICENSE_FLOOR names the
--     assigned figure; raw unit count no longer blocks.
--   Renew with assigned=5, licences=55 -> renewal invoice stays 55 (GREATEST);
--     with assigned=60 -> renewal clamps UP to 60. Units count never enters.
