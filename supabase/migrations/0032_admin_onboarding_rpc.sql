-- ============================================================
-- 0032_admin_onboarding_rpc.sql
-- Atomic RPC called from the onboarding wizard at the end of registration.
--
-- Does in one transaction:
--   1. Sets the caller's profile status → 'active' (bypasses approval queue
--      for admins — they are self-provisioning paying customers).
--   2. Creates the entity (building / compound / org).
--   3. The auto_grant_on_entity_create trigger fires → grant is inserted.
--   4. Creates the subscription (trial, 30 days).
--   5. Logs subscription_event: trial_started.
--
-- Returns the new subscription id so the client can redirect correctly.
-- SECURITY DEFINER so it can set profile status without the self-update guard.
-- Additive & idempotent. Transactional (implicit in the function body).
-- ============================================================

CREATE OR REPLACE FUNCTION complete_admin_onboarding(
  p_scope_type        TEXT,    -- 'building' | 'compound' | 'org'
  p_entity_name       TEXT,    -- name of the building / compound / org
  p_city              TEXT,    -- city (used for building + compound; ignored for org)
  p_unit_count        INTEGER, -- how many licenses to start with
  p_plan              TEXT,    -- 'monthly' | 'annual'
  p_billing_email     TEXT     -- usually the user's own email
)
RETURNS UUID                   -- returns new subscription id
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_entity_id   UUID;
  v_sub_id      UUID;
  v_price_cents INTEGER;
BEGIN
  -- Guard: must be called by an authenticated user
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Guard: scope_type must be valid
  IF p_scope_type NOT IN ('building','compound','org') THEN
    RAISE EXCEPTION 'Invalid scope_type: %', p_scope_type;
  END IF;

  -- Guard: entity_name required
  IF trim(p_entity_name) = '' THEN
    RAISE EXCEPTION 'Entity name is required';
  END IF;

  -- Guard: plan must be valid
  IF p_plan NOT IN ('monthly','annual') THEN
    RAISE EXCEPTION 'Invalid plan: %', p_plan;
  END IF;

  -- Guard: unit_count must be positive
  IF p_unit_count < 1 THEN
    RAISE EXCEPTION 'unit_count must be at least 1';
  END IF;

  -- 1. Activate profile (admins skip the approval queue)
  UPDATE profiles
  SET status = 'active'
  WHERE id = v_user_id AND status <> 'active';

  -- 2. Price in cents
  v_price_cents := CASE p_plan
    WHEN 'monthly' THEN 500   -- $5.00 / unit / month
    WHEN 'annual'  THEN 5000  -- $50.00 / unit / year
  END;

  -- 3. Create entity (trigger auto_grant_on_entity_create fires here)
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

  -- 4. Create subscription (trial, 30 days)
  INSERT INTO subscriptions (
    scope_type,
    building_id, compound_id, org_id,
    plan,
    status,
    trial_ends_at,
    license_count,
    price_per_unit_cents,
    billing_email,
    created_by
  ) VALUES (
    p_scope_type,
    CASE WHEN p_scope_type = 'building'  THEN v_entity_id ELSE NULL END,
    CASE WHEN p_scope_type = 'compound'  THEN v_entity_id ELSE NULL END,
    CASE WHEN p_scope_type = 'org'       THEN v_entity_id ELSE NULL END,
    p_plan,
    'trial',
    now() + INTERVAL '30 days',
    p_unit_count,
    v_price_cents,
    p_billing_email,
    v_user_id
  )
  RETURNING id INTO v_sub_id;

  -- 5. Audit log
  INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
  VALUES (
    v_sub_id,
    'trial_started',
    v_user_id,
    jsonb_build_object(
      'plan',        p_plan,
      'unit_count',  p_unit_count,
      'scope_type',  p_scope_type,
      'entity_id',   v_entity_id,
      'entity_name', p_entity_name
    )
  );

  RETURN v_sub_id;
END;
$$;

-- Allow any authenticated user to call this RPC
GRANT EXECUTE ON FUNCTION complete_admin_onboarding TO authenticated;

-- ============================================================
-- Post-run check:
--   SELECT complete_admin_onboarding(
--     'building', 'Test Tower', 'Beirut', 10, 'monthly', 'test@example.com'
--   );
--   -- expect: a UUID (subscription id)
--   -- check buildings, grants, subscriptions, subscription_events tables
-- ============================================================
