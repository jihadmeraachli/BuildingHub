-- ============================================================
-- 0037_onboarding_status_guard_fix.sql
-- Bug: complete_admin_onboarding() (0032) activates the caller's profile, but
-- the profiles_self_update_guard trigger (0029) blocks ANY self status change —
-- auth.uid() is still the caller inside a SECURITY DEFINER function, so
-- self-service registration died with "You cannot change your own account status."
--
-- Fix: the RPC raises a TRANSACTION-LOCAL flag (set_config ... is_local=true)
-- right before activating the profile, and the guard allows exactly that case:
-- flag set AND the change is "become active". Everything else stays locked:
--   - is_platform_admin / role / building_id / apartment self-changes: still blocked
--   - status self-change outside the onboarding transaction: still blocked
-- The flag cannot be set via the API (set_config isn't exposed), and it dies
-- with the transaction.
--
-- Additive & idempotent. Transactional.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Guard (0029) — unchanged except the sanctioned-onboarding carve-out.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION profiles_self_update_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- service-role / edge-function context (invite-user, etc.): trusted.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  -- Platform admins are the operator; the flag exists for them.
  IF is_platform_admin() THEN RETURN NEW; END IF;

  -- Nobody may hand themselves privileges.
  IF NEW.id = auth.uid() THEN
    IF NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin THEN
      RAISE EXCEPTION 'You cannot change your own platform-admin flag.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      -- Sanctioned exception: complete_admin_onboarding() sets this
      -- transaction-local flag just before activating the new admin (0037).
      IF NOT (current_setting('abniyah.onboarding', true) = '1' AND NEW.status = 'active') THEN
        RAISE EXCEPTION 'You cannot change your own account status.' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'You cannot change your own role.' USING ERRCODE = '42501';
    END IF;
    IF NEW.building_id IS DISTINCT FROM OLD.building_id THEN
      RAISE EXCEPTION 'You cannot move yourself to another building.' USING ERRCODE = '42501';
    END IF;
    IF NEW.apartment_number IS DISTINCT FROM OLD.apartment_number THEN
      RAISE EXCEPTION 'Your apartment is set by your building admin.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- ...and non-platform admins may not hand it to anyone ELSE either.
  IF NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin THEN
    RAISE EXCEPTION 'Only a platform admin can change the platform-admin flag.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_self_update_guard_trg ON profiles;
CREATE TRIGGER profiles_self_update_guard_trg
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_self_update_guard();

-- ------------------------------------------------------------
-- 2. RPC (0032) — unchanged except raising the flag before activation.
-- ------------------------------------------------------------
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

  -- Sanctioned self-activation: transaction-local flag read by the guard (0037).
  PERFORM set_config('abniyah.onboarding', '1', true);

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

GRANT EXECUTE ON FUNCTION complete_admin_onboarding TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   -- 1. Self status change still blocked outside onboarding (as a non-admin
--   --    user in the app console):
--   --    supabase.from('profiles').update({status:'active'}).eq('id', myId)
--   --    expect: 'You cannot change your own account status.'
--   -- 2. Registration flow now completes: run the wizard end-to-end.
-- ============================================================
