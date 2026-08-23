-- ============================================================
-- 0107_fund_position_residents.sql
-- fund_position() for residents, for real this time.
--
-- 0106 promised residents the building's cash as AGGREGATES. It computed the
-- credits/arrears split by calling unit_balance_asof() per unit, and that
-- function carries its own per-unit gate (0043): a resident asking about the
-- building trips it on the first neighbour's unit and the whole call fails
-- with 42501. Found by calling the RPC as the demo owner after 0106 landed.
--
-- Fix: the same formula as unit_balance_asof (opening + payments − charges +
-- adjustments, as of), inline, summed. Nothing per-unit ever leaves the
-- function — only the two sums — so the gate was protecting nothing here and
-- the transparency promise now holds. Manager results are unchanged to the
-- cent (identical arithmetic).
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

DROP FUNCTION IF EXISTS fund_position(UUID[], DATE);
CREATE OR REPLACE FUNCTION fund_position(
  p_building_ids UUID[],
  p_to           DATE DEFAULT NULL
)
RETURNS TABLE(
  opening       NUMERIC,
  payments_in   NUMERIC,
  other_in      NUMERIC,
  expenses_out  NUMERIC,
  other_out     NUMERIC,
  refunds_out   NUMERIC,
  cash          NUMERIC,
  credits       NUMERIC,
  arrears       NUMERIC,
  available     NUMERIC,
  reserve       NUMERIC,
  fund_paid     NUMERIC,
  unreconciled  INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_seen  UUID[];
  v_ids   UUID[];
  v_comp  UUID[];
  v_to    DATE := COALESCE(p_to, CURRENT_DATE);
BEGIN
  SELECT array_agg(id) INTO v_seen
  FROM unnest(p_building_ids) AS id
  WHERE is_platform_admin() OR user_can(id, 'finance.view') OR user_member_building(id);
  IF v_seen IS NULL THEN RETURN; END IF;

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
            (f.building_id = ANY(v_ids)
              AND f.building_id IN (SELECT id FROM buildings WHERE compound_id IS NULL))
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
  -- per-unit balance, same formula as unit_balance_asof (0043) but ungated:
  -- only the two sums below leave the function
  ub AS (
    SELECT u.id,
      ROUND(
          CASE WHEN u.opening_balance_date IS NULL OR u.opening_balance_date <= v_to THEN u.opening_balance ELSE 0 END
        + COALESCE((SELECT SUM(p.amount_usd) FROM payments p
                     WHERE p.unit_id = u.id AND p.voided_at IS NULL AND p.paid_on <= v_to), 0)
        - COALESCE((SELECT SUM(c.amount_usd) FROM charges c
                     WHERE c.unit_id = u.id AND c.voided_at IS NULL AND c.charge_date <= v_to), 0)
        + COALESCE((SELECT SUM(adjustment_effect(a.kind, a.amount_usd)) FROM adjustments a
                     WHERE a.unit_id = u.id AND a.voided_at IS NULL AND a.effective_date <= v_to), 0)
      , 2) AS bal
    FROM units u
    WHERE u.building_id = ANY(v_ids) AND u.created_at::date <= v_to
  ),
  bal AS (
    SELECT COALESCE(SUM(GREATEST(0,  ub.bal)), 0) AS cr,
           COALESCE(SUM(GREATEST(0, -ub.bal)), 0) AS ar
    FROM ub
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
    ROUND(op.v + pin.v + oin.v - exo.v - oout.v - ref.v, 2),
    ROUND(bal.cr, 2), ROUND(bal.ar, 2),
    ROUND(op.v + pin.v + oin.v - exo.v - oout.v - ref.v - bal.cr, 2),
    ROUND(op.v + pin.v + oin.v - exo.v - oout.v - ref.v - bal.cr + bal.ar, 2),
    ROUND(exo.fp, 2), unrec.n
  FROM op, pin, oin, exo, oout, ref, bal, unrec;
END;
$$;
GRANT EXECUTE ON FUNCTION fund_position(UUID[], DATE) TO authenticated;

COMMIT;

-- Post-run checks:
--   As a resident:  supabase.rpc('fund_position', { p_building_ids: [myBuildingId] })
--     → ONE row (was 42501 after 0106). As a manager: identical numbers to before.
--   As an unrelated user → zero rows.
