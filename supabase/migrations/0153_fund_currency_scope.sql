-- ============================================================
-- 0153_fund_currency_scope.sql
-- The drawer, split by currency - and by block when the compound wants it.
-- (Jey + Ahmad, 2026-08-27.)
--
-- TWO DECISIONS.
--
-- 1. CASH IS SHOWN PER CURRENCY. Lebanon reality: the box holds dollars AND
--    lira. Since 0086 every payment/expense/fund entry logs its LBP part and
--    frozen rate, converted into one canonical amount_usd - the BOOK stays
--    USD and is untouched here. What was missing is the physical count: the
--    USD drawer is the sum of USD parts, the LBP drawer is the sum of raw LBP
--    parts, NEVER re-rated - so the numbers match a recount of the box no
--    matter what the rate does. fund_position() now returns both
--    (cash_usd, cash_lbp) next to the canonical cash.
--
-- 2. WHO HOLDS THE CASH IS A COMPOUND SETTING. compounds.fund_scope:
--      'compound' (default) - one box, one committee. 0106 behavior exactly.
--      'block'              - each block keeps its own box: funds rows live
--                             per building, fund_position() stops widening
--                             blocks to their compound, and compound-wide
--                             money must say WHICH block's box paid
--                             (expenses.paid_from_building_id; fund entries
--                             just carry building_id). Compound-level rows
--                             that name no box are counted and surfaced
--                             (unattributed) instead of silently vanishing
--                             or double-counting.
--    Switching is a physical recount, not arithmetic: the UI archives nothing
--    but the openings of the other scope simply stop applying - the admin
--    re-enters what each box actually holds.
--
-- Openings follow the 0086 pattern: opening_balance_usd stays the USD-drawer
-- part; opening_balance_lbp + opening_lbp_rate log the lira and its frozen
-- rate. Canonical opening = usd + ROUND(lbp/rate, 2) - existing rows have
-- lbp 0, so nothing changes for them. Refund adjustments finally get the
-- same LBP pair, closing the last drawer leak.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;
SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------------------
-- 1. The setting, the currency columns, the attribution column.
-- ------------------------------------------------------------
ALTER TABLE compounds ADD COLUMN IF NOT EXISTS fund_scope TEXT NOT NULL DEFAULT 'compound';
ALTER TABLE compounds DROP CONSTRAINT IF EXISTS compounds_fund_scope_chk;
ALTER TABLE compounds ADD  CONSTRAINT compounds_fund_scope_chk
  CHECK (fund_scope IN ('compound', 'block'));
COMMENT ON COLUMN compounds.fund_scope IS
  'Who holds the cash: ''compound'' = one box (0106 default), ''block'' = each block its own funds row and drawer.';

ALTER TABLE funds ADD COLUMN IF NOT EXISTS opening_balance_lbp NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE funds ADD COLUMN IF NOT EXISTS opening_lbp_rate    NUMERIC(14,2);
ALTER TABLE funds DROP CONSTRAINT IF EXISTS funds_opening_lbp_chk;
ALTER TABLE funds ADD  CONSTRAINT funds_opening_lbp_chk
  CHECK (opening_balance_lbp = 0 OR (opening_lbp_rate IS NOT NULL AND opening_lbp_rate > 0));
COMMENT ON COLUMN funds.opening_balance_usd IS
  'The USD part of the opening drawer. Canonical opening = this + ROUND(opening_balance_lbp / opening_lbp_rate, 2).';

-- refunds handed back in lira - same frozen-rate pair as payments/expenses (0086)
ALTER TABLE adjustments ADD COLUMN IF NOT EXISTS amount_lbp NUMERIC(18,2);
ALTER TABLE adjustments ADD COLUMN IF NOT EXISTS lbp_rate   NUMERIC(14,2);
ALTER TABLE adjustments DROP CONSTRAINT IF EXISTS adjustments_lbp_pair_chk;
ALTER TABLE adjustments ADD  CONSTRAINT adjustments_lbp_pair_chk
  CHECK ((amount_lbp IS NULL) = (lbp_rate IS NULL));

-- block-mode compounds: a compound-wide expense physically left ONE block's
-- box. Attribution only - allocation/billing still follows building_id/scope.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS paid_from_building_id UUID REFERENCES buildings(id) ON DELETE SET NULL;
COMMENT ON COLUMN expenses.paid_from_building_id IS
  'Block whose cash box paid a compound-scope expense (fund_scope=''block'' only). Drawer attribution, never allocation.';

-- ------------------------------------------------------------
-- 2. The setting's sealed setter (pattern: set_lbp_rate, 0086).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_fund_scope(p_compound UUID, p_scope TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_scope NOT IN ('compound', 'block') THEN
    RAISE EXCEPTION 'Unknown fund scope %', p_scope USING ERRCODE = '22023';
  END IF;
  IF NOT (is_platform_admin() OR EXISTS (
    SELECT 1 FROM buildings b WHERE b.compound_id = p_compound AND user_can(b.id, 'expense.manage'))) THEN
    RAISE EXCEPTION 'Not allowed to change who holds the cash here.' USING ERRCODE = '42501';
  END IF;
  UPDATE compounds SET fund_scope = p_scope WHERE id = p_compound;
END;
$$;
GRANT EXECUTE ON FUNCTION set_fund_scope(UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 3. fund_position() v2 - 0106's body + currency drawers + fund_scope.
--    Signature (args) unchanged; return table grows, so drop first.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fund_position(UUID[], DATE);
CREATE OR REPLACE FUNCTION fund_position(
  p_building_ids UUID[],
  p_to           DATE DEFAULT NULL
)
RETURNS TABLE(
  opening       NUMERIC,   -- canonical opening (usd part + rated lbp part)
  payments_in   NUMERIC,   -- Σ unit payments
  other_in      NUMERIC,   -- Σ fund_entries income
  expenses_out  NUMERIC,   -- Σ expenses (billed or not)
  other_out     NUMERIC,   -- Σ fund_entries outflow
  refunds_out   NUMERIC,   -- Σ refund adjustments (cash handed back)
  cash          NUMERIC,   -- C, canonical USD
  credits       NUMERIC,   -- Σ positive unit balances (held for residents / prepaid)
  arrears       NUMERIC,   -- Σ negative unit balances, as a positive number
  available     NUMERIC,   -- C − credits
  reserve       NUMERIC,   -- available + arrears  (= C − N)
  fund_paid     NUMERIC,   -- Σ expenses.funded_by_fund_usd (informational)
  unreconciled  INT,       -- expenses where charges + fund part ≠ amount
  cash_usd      NUMERIC,   -- 0153: the physical USD drawer (Σ usd parts)
  cash_lbp      NUMERIC,   -- 0153: the physical LBP drawer (Σ raw lbp, never re-rated)
  unattributed  INT        -- 0153: block-mode compound-level rows naming no box
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_seen      UUID[];
  v_ids       UUID[];
  v_comp      UUID[];   -- compounds holding ONE box (fund_scope='compound')
  v_blockcomp UUID[];   -- compounds whose blocks hold their OWN boxes
  v_to        DATE := COALESCE(p_to, CURRENT_DATE);
BEGIN
  -- what the caller may see: managers of the block, or residents in it
  SELECT array_agg(id) INTO v_seen
  FROM unnest(p_building_ids) AS id
  WHERE is_platform_admin() OR user_can(id, 'finance.view') OR user_member_building(id);
  IF v_seen IS NULL THEN RETURN; END IF;

  -- one-box compounds: widen every block to the whole compound (0106).
  -- per-block compounds: DON'T widen - each block is its own drawer.
  SELECT array_agg(DISTINCT b.compound_id) INTO v_comp
  FROM buildings b JOIN compounds c ON c.id = b.compound_id
  WHERE b.id = ANY(v_seen) AND c.fund_scope = 'compound';
  SELECT array_agg(DISTINCT b.compound_id) INTO v_blockcomp
  FROM buildings b JOIN compounds c ON c.id = b.compound_id
  WHERE b.id = ANY(v_seen) AND c.fund_scope = 'block';
  SELECT array_agg(DISTINCT b.id) INTO v_ids
  FROM buildings b
  WHERE b.id = ANY(v_seen)
     OR (v_comp IS NOT NULL AND b.compound_id = ANY(v_comp));

  RETURN QUERY
  WITH
  op AS (
    SELECT COALESCE(SUM(f.opening_balance_usd
             + COALESCE(ROUND(f.opening_balance_lbp / NULLIF(f.opening_lbp_rate, 0), 2), 0)), 0) AS v,
           COALESCE(SUM(f.opening_balance_usd), 0)               AS usd,
           COALESCE(SUM(COALESCE(f.opening_balance_lbp, 0)), 0)  AS lbp
    FROM funds f
    WHERE (
            -- a block's own fund: standalone, or inside a per-block compound
            (f.building_id = ANY(v_ids) AND f.building_id IN (
               SELECT b.id FROM buildings b LEFT JOIN compounds c ON c.id = b.compound_id
               WHERE b.compound_id IS NULL OR c.fund_scope = 'block'))
            -- or the one-box compound's fund
            OR (v_comp IS NOT NULL AND f.compound_id = ANY(v_comp))
          )
      AND (f.opening_date IS NULL OR f.opening_date <= v_to)
  ),
  pin AS (
    SELECT COALESCE(SUM(p.amount_usd), 0) AS v,
           COALESCE(SUM(ROUND(p.amount_usd - COALESCE(p.amount_lbp / NULLIF(p.lbp_rate, 0), 0), 2)), 0) AS usd,
           COALESCE(SUM(COALESCE(p.amount_lbp, 0)), 0) AS lbp
    FROM payments p
    WHERE p.building_id = ANY(v_ids) AND p.voided_at IS NULL AND p.paid_on <= v_to
  ),
  oin AS (
    SELECT COALESCE(SUM(e.amount_usd), 0) AS v,
           COALESCE(SUM(ROUND(e.amount_usd - COALESCE(e.amount_lbp / NULLIF(e.lbp_rate, 0), 0), 2)), 0) AS usd,
           COALESCE(SUM(COALESCE(e.amount_lbp, 0)), 0) AS lbp
    FROM fund_entries e
    WHERE e.kind = 'income' AND e.voided_at IS NULL AND e.entry_date <= v_to
      AND (e.building_id = ANY(v_ids) OR (v_comp IS NOT NULL AND e.compound_id = ANY(v_comp)))
  ),
  exo AS (
    -- drawer attribution: paid_from overrides the block for compound-wide
    -- expenses in per-block compounds; everywhere else it is NULL and the
    -- unit's own block applies, exactly as before.
    SELECT COALESCE(SUM(x.amount_usd), 0) AS v,
           COALESCE(SUM(x.funded_by_fund_usd), 0) AS fp,
           COALESCE(SUM(ROUND(x.amount_usd - COALESCE(x.amount_lbp / NULLIF(x.lbp_rate, 0), 0), 2)), 0) AS usd,
           COALESCE(SUM(COALESCE(x.amount_lbp, 0)), 0) AS lbp
    FROM expenses x
    WHERE x.expense_date <= v_to
      AND (COALESCE(x.paid_from_building_id, x.building_id) = ANY(v_ids)
           OR (v_comp IS NOT NULL AND x.compound_id = ANY(v_comp)))
  ),
  oout AS (
    SELECT COALESCE(SUM(e.amount_usd), 0) AS v,
           COALESCE(SUM(ROUND(e.amount_usd - COALESCE(e.amount_lbp / NULLIF(e.lbp_rate, 0), 0), 2)), 0) AS usd,
           COALESCE(SUM(COALESCE(e.amount_lbp, 0)), 0) AS lbp
    FROM fund_entries e
    WHERE e.kind = 'outflow' AND e.voided_at IS NULL AND e.entry_date <= v_to
      AND (e.building_id = ANY(v_ids) OR (v_comp IS NOT NULL AND e.compound_id = ANY(v_comp)))
  ),
  ref AS (
    SELECT COALESCE(SUM(a.amount_usd), 0) AS v,
           COALESCE(SUM(ROUND(a.amount_usd - COALESCE(a.amount_lbp / NULLIF(a.lbp_rate, 0), 0), 2)), 0) AS usd,
           COALESCE(SUM(COALESCE(a.amount_lbp, 0)), 0) AS lbp
    FROM adjustments a
    WHERE a.building_id = ANY(v_ids) AND a.kind = 'refund' AND a.voided_at IS NULL
      AND a.effective_date <= v_to
  ),
  bal AS (
    SELECT
      COALESCE(SUM(GREATEST(0,  unit_balance_asof(u.id, v_to))), 0) AS cr,
      COALESCE(SUM(GREATEST(0, -unit_balance_asof(u.id, v_to))), 0) AS ar
    FROM units u
    WHERE u.building_id = ANY(v_ids) AND u.created_at::date <= v_to
  ),
  unrec AS (
    SELECT COUNT(*)::int AS n
    FROM expenses x
    LEFT JOIN (SELECT expense_id, SUM(amount_usd) AS billed FROM charges
                WHERE voided_at IS NULL GROUP BY expense_id) c ON c.expense_id = x.id
    WHERE x.expense_date <= v_to
      AND (COALESCE(x.paid_from_building_id, x.building_id) = ANY(v_ids)
           OR (v_comp IS NOT NULL AND x.compound_id = ANY(v_comp)))
      AND ABS(x.amount_usd - COALESCE(c.billed, 0) - x.funded_by_fund_usd) > 0.005
  ),
  unattr AS (
    -- per-block compounds: compound-level money that names no box counts in
    -- NO drawer. Surface it so the admin re-files each row, never guess.
    SELECT (COALESCE((SELECT COUNT(*) FROM expenses x
              WHERE v_blockcomp IS NOT NULL AND x.compound_id = ANY(v_blockcomp)
                AND x.building_id IS NULL AND x.paid_from_building_id IS NULL
                AND x.expense_date <= v_to), 0)
          + COALESCE((SELECT COUNT(*) FROM fund_entries e
              WHERE v_blockcomp IS NOT NULL AND e.compound_id = ANY(v_blockcomp)
                AND e.building_id IS NULL AND e.voided_at IS NULL
                AND e.entry_date <= v_to), 0))::int AS n
  )
  SELECT
    ROUND(op.v, 2), ROUND(pin.v, 2), ROUND(oin.v, 2), ROUND(exo.v, 2), ROUND(oout.v, 2), ROUND(ref.v, 2),
    ROUND(op.v + pin.v + oin.v - exo.v - oout.v - ref.v, 2)                       AS cash,
    ROUND(bal.cr, 2), ROUND(bal.ar, 2),
    ROUND(op.v + pin.v + oin.v - exo.v - oout.v - ref.v - bal.cr, 2)              AS available,
    ROUND(op.v + pin.v + oin.v - exo.v - oout.v - ref.v - bal.cr + bal.ar, 2)     AS reserve,
    ROUND(exo.fp, 2), unrec.n,
    ROUND(op.usd + pin.usd + oin.usd - exo.usd - oout.usd - ref.usd, 2)           AS cash_usd,
    ROUND(op.lbp + pin.lbp + oin.lbp - exo.lbp - oout.lbp - ref.lbp, 2)           AS cash_lbp,
    unattr.n
  FROM op, pin, oin, exo, oout, ref, bal, unrec, unattr;
END;
$$;
GRANT EXECUTE ON FUNCTION fund_position(UUID[], DATE) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks (SQL Editor):
--   1. Nothing moved for existing data:
--        SELECT cash, cash_usd, cash_lbp FROM fund_position(ARRAY(SELECT id FROM buildings));
--      → cash identical to before; cash_usd + rated LBP ≈ cash; cash_lbp = Σ raw LBP so far.
--   2. SELECT set_fund_scope('<compound-id>', 'block');  → per-block:
--        SELECT cash_usd, cash_lbp FROM fund_position(ARRAY['<one-block-id>'::uuid]);
--      returns that block's own drawer (no compound widening).
--   3. A compound-scope expense with paid_from_building_id lands in that
--      block's numbers; one without it raises `unattributed` by 1.
--   4. INSERT an adjustment with amount_lbp but no lbp_rate → CHECK rejects.
--   5. As a resident: fund_position for their building still returns one row.
-- ============================================================
