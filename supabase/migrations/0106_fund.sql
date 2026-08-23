-- ============================================================
-- 0106_fund.sql
-- Cash on hand, separated from what residents owe.
--
-- WHY. The book has always been RECEIVABLES: every unit's balance is
-- opening + payments − charges (+ adjustments), and the dashboard "Fund
-- balance" is the sum of those balances (0061). That number is what residents
-- owe or are owed, net. It was never the money in the drawer, and two things
-- fall through the gap:
--
--   1. An expense that is not billed to anyone. The split form accepts any
--      custom amounts (no sum check), so $1,000 can be recorded with $600 of
--      charges. The $400 left the building and NOTHING in the app noticed —
--      the hero is built from charges, not expenses.
--   2. Money the building holds that did not come from a unit (the antenna
--      company's rent, bank interest) or left without being an expense (a cash
--      refund handed over, a withdrawal). No row type exists for either.
--
-- THE MODEL. One equation, three numbers, no new ledger for residents:
--
--   N  residents' net position = Σ unit balances            (unchanged, 0043)
--   C  cash on hand            = opening + Σ payments + Σ other in
--                                − Σ expenses − Σ other out − Σ refunds paid
--   R  reserve (the building's own money) = C − N
--
-- Substituting shows what R actually is: opening − carry + (Σ charges − Σ
-- expenses) + other in − other out − refunds. In a pass-through arrears
-- building charges equal expenses, so R is ZERO by construction — every
-- dollar billed was against a bill. R only grows from charges that are not
-- expenses (dues, levies) and only shrinks when an expense goes unbilled.
--
-- THE NEIGHBOUR WHO PAID MORE. Their overpayment is a positive balance inside
-- N. It is in the drawer (inside C) but it is HELD FOR THEM and future charges
-- will consume it; it is never the building's money and never appears in R.
-- Same for dues prepayments — they sit in N as credit and the presentation
-- says "prepaid for the budget" instead of "held". The arithmetic is identical.
--
-- WHAT THIS MIGRATION ADDS.
--   expenses.funded_by_fund_usd   the part of an expense NOT billed to units.
--                                 Backfilled from history: whatever was never
--                                 charged came out of the building's money.
--   funds                         one row per compound (or standalone block):
--                                 the opening cash and a name.
--   fund_entries                  money in/out that is not a unit payment or
--                                 an expense.
--   fund_position(ids, asof)      the numbers above, gated like the dashboard;
--                                 residents may call it (aggregates only).
--
-- Cash is a COMPOUND-level fact: payments land per block but the committee
-- holds one drawer. The function therefore widens any block in the input to
-- its whole compound before summing.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. The unbilled part of an expense, made explicit.
-- ------------------------------------------------------------
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS funded_by_fund_usd NUMERIC(12,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN expenses.funded_by_fund_usd IS
  'Part of amount_usd NOT billed to units — paid from the building''s own money. charges + this = amount_usd.';

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_fund_part_chk;
ALTER TABLE expenses ADD CONSTRAINT expenses_fund_part_chk
  CHECK (funded_by_fund_usd >= 0 AND funded_by_fund_usd <= amount_usd);

-- Backfill (idempotent: only rows still at 0 with a real gap). Metered expenses
-- are guarded by trg_guard_metered_expense (0092) on their MONEY fields; this
-- column is not one of them, so the update passes.
UPDATE expenses e
   SET funded_by_fund_usd = ROUND(e.amount_usd - COALESCE(c.billed, 0), 2)
  FROM (SELECT expense_id, SUM(amount_usd) AS billed
          FROM charges WHERE voided_at IS NULL GROUP BY expense_id) c
 WHERE c.expense_id = e.id
   AND e.funded_by_fund_usd = 0
   AND e.amount_usd - c.billed > 0.005;

-- expenses with NO charges at all (the "all boxes empty" case)
UPDATE expenses e
   SET funded_by_fund_usd = e.amount_usd
 WHERE e.funded_by_fund_usd = 0
   AND e.amount_usd > 0
   AND NOT EXISTS (SELECT 1 FROM charges c WHERE c.expense_id = e.id AND c.voided_at IS NULL);

-- ------------------------------------------------------------
-- 2. The fund: one per compound, or per standalone block.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS funds (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id         UUID REFERENCES buildings(id) ON DELETE CASCADE,
  compound_id         UUID REFERENCES compounds(id) ON DELETE CASCADE,
  name                TEXT NOT NULL DEFAULT 'Main fund',
  opening_balance_usd NUMERIC(12,2) NOT NULL DEFAULT 0,
  opening_date        DATE,
  note                TEXT,
  created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT funds_scope CHECK ((building_id IS NOT NULL) <> (compound_id IS NOT NULL))
);
-- one fund per scope for now; a second currency later is a second row and a
-- relaxed index, not a rewrite
CREATE UNIQUE INDEX IF NOT EXISTS funds_building_uidx ON funds(building_id) WHERE building_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS funds_compound_uidx ON funds(compound_id) WHERE compound_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS fund_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id    UUID REFERENCES buildings(id) ON DELETE CASCADE,
  compound_id    UUID REFERENCES compounds(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('income','outflow')),
  amount_usd     NUMERIC(12,2) NOT NULL CHECK (amount_usd > 0),
  amount_lbp     NUMERIC(18,2),
  lbp_rate       NUMERIC(14,2),
  entry_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  description    TEXT NOT NULL,
  counterparty   TEXT,
  attachment_url TEXT,
  created_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at      TIMESTAMPTZ,
  voided_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  void_reason    TEXT,
  CONSTRAINT fund_entries_scope CHECK ((building_id IS NOT NULL) <> (compound_id IS NOT NULL)),
  CONSTRAINT fund_entries_lbp_pair CHECK ((amount_lbp IS NULL) = (lbp_rate IS NULL))
);
CREATE INDEX IF NOT EXISTS fund_entries_building_idx ON fund_entries(building_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS fund_entries_compound_idx ON fund_entries(compound_id, entry_date DESC);

COMMENT ON TABLE fund_entries IS
  'Cash that is not a unit payment or an expense: other income in (rent from a third party, interest), outflows out (a cash refund handed over, a withdrawal).';

-- ---- RLS: managers read rows; residents only ever see aggregates (function below) ----
ALTER TABLE funds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fund_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS funds_select ON funds;
CREATE POLICY funds_select ON funds FOR SELECT USING (
  (building_id IS NOT NULL AND user_can(building_id, 'finance.view'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = funds.compound_id
          AND user_can(b.id, 'finance.view')))
);
DROP POLICY IF EXISTS funds_write ON funds;
CREATE POLICY funds_write ON funds FOR ALL USING (
  (building_id IS NOT NULL AND user_can(building_id, 'expense.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = funds.compound_id
          AND user_can(b.id, 'expense.manage')))
) WITH CHECK (
  (building_id IS NOT NULL AND user_can(building_id, 'expense.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = funds.compound_id
          AND user_can(b.id, 'expense.manage')))
);

DROP POLICY IF EXISTS fund_entries_select ON fund_entries;
CREATE POLICY fund_entries_select ON fund_entries FOR SELECT USING (
  (building_id IS NOT NULL AND user_can(building_id, 'finance.view'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = fund_entries.compound_id
          AND user_can(b.id, 'finance.view')))
);
DROP POLICY IF EXISTS fund_entries_write ON fund_entries;
CREATE POLICY fund_entries_write ON fund_entries FOR ALL USING (
  (building_id IS NOT NULL AND user_can(building_id, 'expense.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = fund_entries.compound_id
          AND user_can(b.id, 'expense.manage')))
) WITH CHECK (
  (building_id IS NOT NULL AND user_can(building_id, 'expense.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = fund_entries.compound_id
          AND user_can(b.id, 'expense.manage')))
);

-- ------------------------------------------------------------
-- 3. The position. Same gate as dashboard_stats plus residents of the
--    building (aggregates only — this is the transparency promise).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS fund_position(UUID[], DATE);
CREATE OR REPLACE FUNCTION fund_position(
  p_building_ids UUID[],
  p_to           DATE DEFAULT NULL
)
RETURNS TABLE(
  opening       NUMERIC,   -- Σ funds.opening_balance_usd in scope
  payments_in   NUMERIC,   -- Σ unit payments
  other_in      NUMERIC,   -- Σ fund_entries income
  expenses_out  NUMERIC,   -- Σ expenses (billed or not)
  other_out     NUMERIC,   -- Σ fund_entries outflow
  refunds_out   NUMERIC,   -- Σ refund adjustments (cash handed back)
  cash          NUMERIC,   -- C
  credits       NUMERIC,   -- Σ positive unit balances (held for residents / prepaid)
  arrears       NUMERIC,   -- Σ negative unit balances, as a positive number
  available     NUMERIC,   -- C − credits
  reserve       NUMERIC,   -- available + arrears  (= C − N)
  fund_paid     NUMERIC,   -- Σ expenses.funded_by_fund_usd (informational)
  unreconciled  INT        -- expenses where charges + fund part ≠ amount
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_seen  UUID[];
  v_ids   UUID[];
  v_comp  UUID[];
  v_to    DATE := COALESCE(p_to, CURRENT_DATE);
BEGIN
  -- what the caller may see: managers of the block, or residents in it
  SELECT array_agg(id) INTO v_seen
  FROM unnest(p_building_ids) AS id
  WHERE is_platform_admin() OR user_can(id, 'finance.view') OR user_member_building(id);
  IF v_seen IS NULL THEN RETURN; END IF;

  -- cash is held per compound: widen every block to its whole compound
  SELECT array_agg(DISTINCT compound_id) INTO v_comp
  FROM buildings WHERE id = ANY(v_seen) AND compound_id IS NOT NULL;
  SELECT array_agg(DISTINCT b.id) INTO v_ids
  FROM buildings b
  WHERE b.id = ANY(v_seen)
     OR (v_comp IS NOT NULL AND b.compound_id = ANY(v_comp));

  RETURN QUERY
  WITH
  op AS (
    SELECT COALESCE(SUM(f.opening_balance_usd), 0) AS v FROM funds f
    WHERE (
            -- a standalone block's own fund …
            (f.building_id = ANY(v_ids)
              AND f.building_id IN (SELECT id FROM buildings WHERE compound_id IS NULL))
            -- … or the compound's; never a stray block-level row inside a compound
            OR (v_comp IS NOT NULL AND f.compound_id = ANY(v_comp))
          )
      AND (f.opening_date IS NULL OR f.opening_date <= v_to)
  ),
  pin AS (
    SELECT COALESCE(SUM(p.amount_usd), 0) AS v FROM payments p
    WHERE p.building_id = ANY(v_ids) AND p.voided_at IS NULL AND p.paid_on <= v_to
  ),
  oin AS (
    SELECT COALESCE(SUM(e.amount_usd), 0) AS v FROM fund_entries e
    WHERE e.kind = 'income' AND e.voided_at IS NULL AND e.entry_date <= v_to
      AND (e.building_id = ANY(v_ids) OR (v_comp IS NOT NULL AND e.compound_id = ANY(v_comp)))
  ),
  exo AS (
    SELECT COALESCE(SUM(x.amount_usd), 0) AS v, COALESCE(SUM(x.funded_by_fund_usd), 0) AS fp
    FROM expenses x
    WHERE x.expense_date <= v_to
      AND (x.building_id = ANY(v_ids) OR (v_comp IS NOT NULL AND x.compound_id = ANY(v_comp)))
  ),
  oout AS (
    SELECT COALESCE(SUM(e.amount_usd), 0) AS v FROM fund_entries e
    WHERE e.kind = 'outflow' AND e.voided_at IS NULL AND e.entry_date <= v_to
      AND (e.building_id = ANY(v_ids) OR (v_comp IS NOT NULL AND e.compound_id = ANY(v_comp)))
  ),
  ref AS (
    SELECT COALESCE(SUM(a.amount_usd), 0) AS v FROM adjustments a
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
      AND (x.building_id = ANY(v_ids) OR (v_comp IS NOT NULL AND x.compound_id = ANY(v_comp)))
      AND ABS(x.amount_usd - COALESCE(c.billed, 0) - x.funded_by_fund_usd) > 0.005
  )
  SELECT
    ROUND(op.v, 2), ROUND(pin.v, 2), ROUND(oin.v, 2), ROUND(exo.v, 2), ROUND(oout.v, 2), ROUND(ref.v, 2),
    ROUND(op.v + pin.v + oin.v - exo.v - oout.v - ref.v, 2)                       AS cash,
    ROUND(bal.cr, 2), ROUND(bal.ar, 2),
    ROUND(op.v + pin.v + oin.v - exo.v - oout.v - ref.v - bal.cr, 2)              AS available,
    ROUND(op.v + pin.v + oin.v - exo.v - oout.v - ref.v - bal.cr + bal.ar, 2)     AS reserve,
    ROUND(exo.fp, 2), unrec.n
  FROM op, pin, oin, exo, oout, ref, bal, unrec;
END;
$$;
GRANT EXECUTE ON FUNCTION fund_position(UUID[], DATE) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks (SQL Editor):
--   1. Backfill landed:
--        SELECT COUNT(*) FROM expenses WHERE funded_by_fund_usd > 0;
--      and the guard is empty —
--        SELECT unreconciled FROM fund_position(ARRAY(SELECT id FROM buildings));
--      → 0
--   2. The identity holds for any scope: reserve = cash − (credits − arrears).
--   3. As a resident (app console):
--        supabase.rpc('fund_position', { p_building_ids: [myBuildingId] })
--      → one row. As an unrelated user → zero rows.
--   4. node scripts/rls-audit.mjs — funds / fund_entries invisible off-scope.
-- ============================================================
