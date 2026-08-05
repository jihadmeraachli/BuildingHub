-- ============================================================
-- 0086_lbp_currency.sql
-- LBP alongside USD on money entry (expert session, 2026-08-05).
--
-- Lebanon reality: one invoice is often paid part-dollars part-lira. So an
-- expense or payment can carry BOTH — a USD part and an LBP part — converted at
-- a rate and stored as ONE canonical USD total:
--
--     amount_usd (canonical, unchanged column) = usd_part + ROUND(lbp/rate, 2)
--
-- The book, dashboards, balances, reminders: all keep reading amount_usd and
-- notice nothing. amount_lbp + lbp_rate are the LOG of how the number came to
-- be — shown on the row (LBP / MIX tag), in the detail, in notifications and
-- reports. The USD part needs no column: amount_usd − ROUND(lbp/rate, 2).
--
-- THE RATE IS FROZEN PER ROW. The building setting only prefills the form;
-- each entry stores the rate it was actually converted at, so changing the
-- setting later rewrites nothing (Ahmad was explicit about this).
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE buildings ADD COLUMN IF NOT EXISTS lbp_rate NUMERIC(14,2);
ALTER TABLE compounds ADD COLUMN IF NOT EXISTS lbp_rate NUMERIC(14,2);
COMMENT ON COLUMN buildings.lbp_rate IS
  'LBP per USD, the FORM PREFILL only. Every expense/payment stores the rate it was actually entered at.';

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS amount_lbp NUMERIC(18,2);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS lbp_rate   NUMERIC(14,2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount_lbp NUMERIC(18,2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS lbp_rate   NUMERIC(14,2);

-- an LBP amount without its rate cannot be reconstructed — forbid the half-row
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_lbp_pair_chk;
ALTER TABLE expenses ADD  CONSTRAINT expenses_lbp_pair_chk
  CHECK ((amount_lbp IS NULL) = (lbp_rate IS NULL));
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_lbp_pair_chk;
ALTER TABLE payments ADD  CONSTRAINT payments_lbp_pair_chk
  CHECK ((amount_lbp IS NULL) = (lbp_rate IS NULL));

-- form prefill: the compound governs its blocks, like billing_mode
DROP FUNCTION IF EXISTS effective_lbp_rate(UUID);
CREATE FUNCTION effective_lbp_rate(p_building UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(c.lbp_rate, b.lbp_rate)
  FROM buildings b LEFT JOIN compounds c ON c.id = b.compound_id
  WHERE b.id = p_building;
$$;
GRANT EXECUTE ON FUNCTION effective_lbp_rate(UUID) TO authenticated;

-- setting the prefill is a money-setting: charge.manage, sealed helper (0047)
DROP FUNCTION IF EXISTS set_lbp_rate(TEXT, UUID, NUMERIC);
CREATE FUNCTION set_lbp_rate(p_scope_type TEXT, p_scope_id UUID, p_rate NUMERIC)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_ok BOOLEAN := FALSE;
BEGIN
  IF p_rate IS NOT NULL AND p_rate <= 0 THEN
    RAISE EXCEPTION 'The LBP rate must be positive.' USING ERRCODE = '22023';
  END IF;
  IF p_scope_type = 'building' THEN
    v_ok := is_platform_admin() OR user_can(p_scope_id, 'charge.manage');
    IF v_ok THEN UPDATE buildings SET lbp_rate = p_rate WHERE id = p_scope_id; END IF;
  ELSIF p_scope_type = 'compound' THEN
    v_ok := is_platform_admin() OR EXISTS (
      SELECT 1 FROM buildings b WHERE b.compound_id = p_scope_id AND user_can(b.id, 'charge.manage'));
    IF v_ok THEN UPDATE compounds SET lbp_rate = p_rate WHERE id = p_scope_id; END IF;
  ELSE
    RAISE EXCEPTION 'Unknown scope %', p_scope_type USING ERRCODE = '22023';
  END IF;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Not allowed to set the exchange rate here.' USING ERRCODE = '42501';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION set_lbp_rate(TEXT, UUID, NUMERIC) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   SELECT set_lbp_rate('building','<id>', 89500);
--   SELECT effective_lbp_rate('<block-in-compound>');  -- compound value wins
--   INSERT a payment with amount_lbp but no lbp_rate → CHECK rejects it.
-- ============================================================
