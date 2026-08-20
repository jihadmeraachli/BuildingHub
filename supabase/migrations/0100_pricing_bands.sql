-- ============================================================
-- 0100_pricing_bands.sql
-- A building pays one monthly price for its size, not a rate per unit
-- (2026-08-20).
--
-- THE PROBLEM. $5 per unit per month, flat, with no volume break. Set against
-- every competitor we could price, it was the most expensive option in the
-- poorest market any of them serve — and worse, the only one that never
-- tapered. PayHOA falls from $1.96 to $0.55 per unit as a community grows; we
-- charged the same $5 at 500 units as at 5. The customers worth most were the
-- ones the price list punished hardest: a 250-unit compound saw $15,000 a year
-- and stopped reading.
--
-- WHY BANDS, NOT A TAPERING PER-UNIT RATE. A per-unit rate that drops at a
-- threshold is not monotonic. At $4 up to 30 units and $3 above it, a 31-unit
-- building pays $93 where a 30-unit one pays $120: cheaper for being bigger,
-- and an invitation to invent a storeroom. Forcing flat per-unit bands to stay
-- monotonic caps each drop at roughly 3%, which is not a taper at all. A flat
-- price per band is monotonic by construction.
--
-- TWO PROPERTIES the numbers hold, and any future edit must keep:
--   1. Monotonic. A bigger building never pays less than a smaller one, so
--      there is nothing to game by inventing a storeroom.
--   2. The per-unit figure descends across bands (4.25, 2.63, 2.14, 1.71,
--      1.40, 1.09, 0.96) so the "as low as" line never goes backwards.
--
-- THE FLOOR. From 17 units up, everyone pays the same or less than the old
-- $5/unit. BELOW 17 THEY PAY MORE: a 10-unit building goes from $50 to $85.
-- That is what a minimum price is, and every product in this category has one
-- (PayHOA charges $49 up to 25 units, so a 5-unit association pays $9.80/unit).
-- Deliberate: a 5-unit building costs about as much to support as a 50-unit
-- one. If very small buildings turn out to be a market worth serving, add a
-- starter band below 20 rather than lowering the floor for everyone.
--
-- ⚠️ Mirrored by src/lib/pricing.ts. Change both, exactly like role_has_cap()
-- and permissions.ts.
--
-- subscriptions.price_per_unit_cents is KEPT and still written: it is what
-- existing subscriptions were sold at, and rewriting it would erase what a
-- customer actually agreed to. New pricing reads the function.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS price_monthly_cents INTEGER;
COMMENT ON COLUMN subscriptions.price_monthly_cents IS
  'The whole monthly price for this subscription. NULL = falls back to the band for its unit count. Set explicitly only for a negotiated deal.';
COMMENT ON COLUMN subscriptions.price_per_unit_cents IS
  'LEGACY (pre-0100): the per-unit rate this subscription was originally sold at. Kept as the record of what the customer agreed to; new pricing comes from monthly_price_cents().';

-- ------------------------------------------------------------
-- The band table, as a function so there is one answer and the app cannot
-- drift from it. Returns NULL above 500 units: that is a conversation, not a
-- price, and a made-up number there loses the biggest deals.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS monthly_price_cents(INT);
CREATE FUNCTION monthly_price_cents(p_units INT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(p_units, 0) <= 0   THEN NULL
    WHEN p_units <= 20  THEN 8500
    WHEN p_units <= 40  THEN 10500
    WHEN p_units <= 70  THEN 15000
    WHEN p_units <= 120 THEN 20500
    WHEN p_units <= 200 THEN 28000
    WHEN p_units <= 350 THEN 38000
    WHEN p_units <= 500 THEN 48000
    ELSE NULL                                   -- 500+ is negotiated
  END;
$$;
GRANT EXECUTE ON FUNCTION monthly_price_cents(INT) TO authenticated;

-- Annual bills 10 months for 12, the same ~17% the per-unit plan gave, so the
-- yearly pitch does not change.
DROP FUNCTION IF EXISTS annual_price_cents(INT);
CREATE FUNCTION annual_price_cents(p_units INT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT monthly_price_cents(p_units) * 10;
$$;
GRANT EXECUTE ON FUNCTION annual_price_cents(INT) TO authenticated;

-- ------------------------------------------------------------
-- What a subscription should be invoiced, so the platform admin is not doing
-- this arithmetic by hand into a free-text box. An explicit
-- price_monthly_cents (a negotiated deal) always wins over the band.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS subscription_price_cents(UUID);
CREATE FUNCTION subscription_price_cents(p_subscription UUID)
RETURNS INTEGER LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_sub RECORD; v_units INT; v_monthly INT;
BEGIN
  SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription;
  IF v_sub IS NULL THEN RETURN NULL; END IF;

  -- Count the units actually in scope, not the licences bought: the price is
  -- for the building, and a half-licensed building is still that size.
  IF v_sub.scope_type = 'building' THEN
    SELECT count(*) INTO v_units FROM units WHERE building_id = v_sub.building_id;
  ELSIF v_sub.scope_type = 'compound' THEN
    SELECT count(*) INTO v_units FROM units u
      JOIN buildings b ON b.id = u.building_id WHERE b.compound_id = v_sub.compound_id;
  ELSE
    SELECT count(*) INTO v_units FROM units u
      JOIN org_buildings ob ON ob.building_id = u.building_id WHERE ob.org_id = v_sub.org_id;
  END IF;

  v_monthly := COALESCE(v_sub.price_monthly_cents, monthly_price_cents(v_units));
  IF v_monthly IS NULL THEN RETURN NULL; END IF;          -- negotiated
  RETURN CASE WHEN v_sub.plan = 'annual' THEN v_monthly * 10 ELSE v_monthly END;
END;
$$;
GRANT EXECUTE ON FUNCTION subscription_price_cents(UUID) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   SELECT monthly_price_cents(20), monthly_price_cents(21), monthly_price_cents(300);
--     → 8500, 10500, 38000
--   SELECT monthly_price_cents(600);   → NULL (negotiated, on purpose)
--
--   Monotonic — a bigger building never pays less. MUST return 0 rows:
--     SELECT n FROM generate_series(2, 500) n
--     WHERE monthly_price_cents(n) < monthly_price_cents(n - 1);
--
--   Where the floor bites. Returns exactly units 1 to 16, which is the
--   deliberate minimum described above, NOT a bug:
--     SELECT n, monthly_price_cents(n), n * 500 AS old_price
--     FROM generate_series(1, 500) n
--     WHERE monthly_price_cents(n) > n * 500;
-- ============================================================
