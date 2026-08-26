-- ============================================================
-- 0152_onboarding_blocks.sql
-- FINAL IMPORT DESIGN, part 1 (Jey, 2026-08-26): a compound's blocks are
-- defined AT REGISTRATION. The wizard's compound path now collects block
-- names ("Add Block"), so the compound enters the system fully shaped, and
-- the Structure import can VALIDATE block names strictly instead of ever
-- creating structure as a side effect. Names are editable later in Buildings.
--
-- Body is 0052's complete_admin_onboarding verbatim + one parameter
-- (p_blocks, default NULL so every existing caller keeps working) + one loop:
-- for a compound, each named block is created as a building row in the new
-- compound. Grants arrive from the existing AFTER INSERT trigger (0096), and
-- the compound-scope grant covers all blocks anyway (0027).
--
-- Additive & idempotent.
-- ============================================================
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION complete_admin_onboarding(
  p_scope_type        TEXT,
  p_entity_name       TEXT,
  p_city              TEXT,
  p_unit_count        INTEGER,
  p_plan              TEXT,
  p_billing_email     TEXT,
  p_blocks            TEXT[] DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_entity_id   UUID;
  v_sub_id      UUID;
  v_price_cents INTEGER;
  v_block       TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Serialize onboarding per account (0051).
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
    -- address is NOT NULL in the v2 schema; the wizard doesn't collect it —
    -- start empty, the admin fills it in Buildings → edit (0052).
    INSERT INTO buildings (name, address, city)
    VALUES (trim(p_entity_name), '', trim(p_city))
    RETURNING id INTO v_entity_id;
  ELSIF p_scope_type = 'compound' THEN
    INSERT INTO compounds (name, city)
    VALUES (trim(p_entity_name), trim(p_city))
    RETURNING id INTO v_entity_id;
    -- 0152: the wizard names the blocks up front, so the compound is born
    -- fully shaped and imports can validate block names strictly. Duplicate
    -- and empty names are skipped, never fatal.
    IF p_blocks IS NOT NULL THEN
      FOREACH v_block IN ARRAY p_blocks LOOP
        IF trim(COALESCE(v_block, '')) <> '' AND NOT EXISTS (
          SELECT 1 FROM buildings b
          WHERE b.compound_id = v_entity_id AND lower(b.name) = lower(trim(v_block))
        ) THEN
          INSERT INTO buildings (name, address, city, compound_id)
          VALUES (trim(v_block), '', trim(p_city), v_entity_id);
        END IF;
      END LOOP;
    END IF;
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
      'entity_id', v_entity_id, 'entity_name', p_entity_name,
      'blocks', COALESCE(array_length(p_blocks, 1), 0)
    )
  );

  RETURN v_sub_id;
END;
$$;

COMMIT;

-- Post-run checks:
--   Register a compound admin naming blocks A + B in the wizard → the compound
--     appears with two blocks already present; Structure import accepts "A"/"B"
--     and rejects anything else with the valid-names error.
--   Existing callers (no p_blocks) → identical behavior to 0052.
--   Duplicate/empty names in the wizard list → skipped silently.
