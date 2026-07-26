-- ============================================================
-- 0051_onboarding_race_lock.sql
-- 0050 made complete_admin_onboarding idempotent, but the check had a race:
-- two CONCURRENT calls (confirmation link opened on two devices/tabs) could
-- both find no existing subscription and both create one ("Atwal Bineye" ×2
-- in production, post-0050).
--
-- Fix: a transaction-scoped advisory lock keyed on the caller serializes
-- onboarding per account — the second call blocks until the first commits,
-- then hits the idempotency check and returns the existing subscription.
--
-- Supersedes 0050 (safe to apply whether or not 0050 was run).
-- Additive & idempotent.
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

  -- Serialize onboarding per account: concurrent calls queue here instead of
  -- double-creating. Lock releases automatically at transaction end.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 42));

  -- Idempotency (0050): already onboarded → return the existing subscription.
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

  -- Sanctioned self-activation flag for the guards (0037/0038/0046).
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
-- Post-run check: fire the RPC twice in the SAME instant (two tabs) as a
-- fresh admin — exactly one entity/subscription must exist afterwards.
-- ============================================================
