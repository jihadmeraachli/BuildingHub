-- ============================================================
-- 0071_license_caps.sql
-- License caps per scope (Jey's numbers): building 50, compound 250,
-- org 2500. The cap is typo/trial-abuse protection AND scope hygiene: a
-- "building admin" with 400 units is structurally mis-registered.
--
-- Enforced in the DATABASE (client checks are UX only):
--   · license_cap(scope) holds the numbers
--   · subscriptions.cap_override (platform-admin-set) is the legit-outlier
--     escape hatch — a real 80-unit tower gets an override, not a schema change
--   · trigger rejects any license_count above the effective cap unless the
--     actor is the platform admin (or service-role context)
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cap_override INTEGER;

COMMENT ON COLUMN subscriptions.cap_override IS
  'Platform-admin-set license cap override for legit outliers. NULL = default license_cap(scope_type): building 50 / compound 250 / org 2500.';

CREATE OR REPLACE FUNCTION license_cap(p_scope TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_scope
    WHEN 'building' THEN 50
    WHEN 'compound' THEN 250
    WHEN 'org'      THEN 2500
    ELSE 50
  END;
$$;

CREATE OR REPLACE FUNCTION subscriptions_cap_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  eff_cap INTEGER;
BEGIN
  -- service-role / edge-function context: trusted (platform ops)
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF is_platform_admin() THEN RETURN NEW; END IF;

  -- only the platform admin may set or change the override
  IF TG_OP = 'INSERT' AND NEW.cap_override IS NOT NULL THEN
    RAISE EXCEPTION 'Only the platform operator can set a license cap override.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.cap_override IS DISTINCT FROM OLD.cap_override THEN
    RAISE EXCEPTION 'Only the platform operator can change the license cap override.' USING ERRCODE = '42501';
  END IF;

  eff_cap := COALESCE(NEW.cap_override, license_cap(NEW.scope_type));
  IF NEW.license_count > eff_cap THEN
    RAISE EXCEPTION 'License limit for this account type is % units. Contact the Abniyah team if you manage more.', eff_cap
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscriptions_cap_guard_trg ON subscriptions;
CREATE TRIGGER subscriptions_cap_guard_trg
  BEFORE INSERT OR UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION subscriptions_cap_guard();

COMMIT;

-- Post-run checks:
--   1. As a building admin: UPDATE subscriptions SET license_count = 60 WHERE <own sub>
--      → 'License limit for this account type is 50 units...'
--   2. As platform admin: same UPDATE succeeds; SET cap_override = 80 succeeds.
--   3. Existing subscriptions above cap are untouched (guard fires on write only).
