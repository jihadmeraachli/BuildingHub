-- ============================================================
-- 0050_onboarding_idempotent.sql
-- Bug: complete_admin_onboarding() created a NEW entity + trial subscription
-- on every call. The register page retries the call until the account's
-- pending_onboarding metadata is cleared — a reload, a second tab, or a slow
-- metadata write in that window duplicated the whole entity (seen live:
-- "El Woroud" ×3, each with its own 10-license trial).
--
-- Fix: the RPC is now idempotent per account — if the caller already owns a
-- non-cancelled subscription created via onboarding, return it and create
-- nothing. Legit accounts never need two onboardings (after the first they
-- hold grants and are routed to the dashboard, not the wizard).
--
-- Additive & idempotent (the migration AND, now, the function).
-- ============================================================

CREATE OR REPLACE FUNCTION complete_admin_onboarding(
  p_scope_type        TEXT,
  p_entity_name       TEXT,
  p_city              TEXT,
  p_unit_count        INTEGER,
  p_plan              TEXT,
  p_billing_email     TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_entity_id   UUID;
  v_sub_id      UUID;
  v_price_cents INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Idempotency: this account already onboarded — return the existing
  -- subscription, create nothing (0050).
  SELECT s.id INTO v_sub_id
  FROM subscriptions s
  WHERE s.created_by = v_user_id AND s.status <> 'cancelled'
  ORDER BY s.created_at ASC
  LIMIT 1;
  IF v_sub_id IS NOT NULL THEN
    RETURN v_sub_id;
  END IF;

  IF p_scope_type NOT IN ('building','compound','org') THEN
    RAISE EXCEPTION 'Invalid scope_type: %', p_scope_type;
  END IF;
  IF trim(p_entity_name) = '' THEN
    RAISE EXCEPTION 'Entity name is required';
  END IF;
  IF p_plan NOT IN ('monthly','annual') THEN
    RAISE EXCEPTION 'Invalid plan: %', p_plan;
  END IF;
  IF p_unit_count < 1 THEN
    RAISE EXCEPTION 'unit_count must be at least 1';
  END IF;

  -- Sanctioned self-activation: transaction-local flag read by the guards
  -- (0037 profile status, 0038 self-grant, 0046 trial_started event).
  PERFORM set_config('abniyah.onboarding', '1', true);

  UPDATE profiles
  SET status = 'active'
  WHERE id = v_user_id AND status <> 'active';

  v_price_cents := CASE p_plan
    WHEN 'monthly' THEN 500   -- $5.00 / unit / month
    WHEN 'annual'  THEN 5000  -- $50.00 / unit / year
  END;

  IF p_scope_type = 'building' THEN
    INSERT INTO buildings (name, city)
    VALUES (trim(p_entity_name), trim(p_city))
    RETURNING id INTO v_entity_id;
  ELSIF p_scope_type = 'compound' THEN
    INSERT INTO compounds (name, city)
    VALUES (trim(p_entity_name), trim(p_city))
    RETURNING id INTO v_entity_id;
  ELSIF p_scope_type = 'org' THEN
    INSERT INTO organizations (name, contact_email)
    VALUES (trim(p_entity_name), p_billing_email)
    RETURNING id INTO v_entity_id;
  END IF;

  INSERT INTO subscriptions (
    scope_type, building_id, compound_id, org_id,
    plan, status, trial_ends_at, license_count,
    price_per_unit_cents, billing_email, created_by
  ) VALUES (
    p_scope_type,
    CASE WHEN p_scope_type = 'building'  THEN v_entity_id ELSE NULL END,
    CASE WHEN p_scope_type = 'compound'  THEN v_entity_id ELSE NULL END,
    CASE WHEN p_scope_type = 'org'       THEN v_entity_id ELSE NULL END,
    p_plan, 'trial', now() + INTERVAL '30 days', p_unit_count,
    v_price_cents, p_billing_email, v_user_id
  )
  RETURNING id INTO v_sub_id;

  INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
  VALUES (
    v_sub_id, 'trial_started', v_user_id,
    jsonb_build_object(
      'plan', p_plan, 'unit_count', p_unit_count, 'scope_type', p_scope_type,
      'entity_id', v_entity_id, 'entity_name', p_entity_name
    )
  );

  RETURN v_sub_id;
END;
$$;

GRANT EXECUTE ON FUNCTION complete_admin_onboarding TO authenticated;

-- ============================================================
-- Post-run check: call the RPC twice as the same fresh admin — the second
-- call must return the SAME uuid and create no new compounds/subscriptions.
-- ============================================================
