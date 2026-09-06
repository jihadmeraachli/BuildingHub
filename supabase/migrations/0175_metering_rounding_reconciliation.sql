-- ============================================================
-- 0175_metering_rounding_reconciliation.sql
-- QA sweep 2026-09-06: a finalized cycle billed $399.98 against a $400.00
-- purchase - each unit's charge rounds to 2dp independently and the lost
-- cents were never reconciled, so "money in = money out" drifted 2c per
-- cycle. The remainder now lands on the largest charge (same rule as the
-- expense allocator). Function body is the LIVE definition + the one block.
-- Additive & idempotent.
-- ============================================================
CREATE OR REPLACE FUNCTION public.finalize_meter_cycle(p_cycle uuid, p_confirm_losses boolean DEFAULT false)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_c        meter_cycles;
  v_s        meter_settings;
  v_type     expense_types;
  v_added_q  NUMERIC; v_added_c NUMERIC;
  v_open_q   NUMERIC; v_open_v  NUMERIC;
  v_close_q  NUMERIC;
  v_consumed NUMERIC;
  v_meters   NUMERIC; v_common NUMERIC;
  v_losses   NUMERIC; v_loss_pct NUMERIC;
  v_rate     NUMERIC; v_pool NUMERIC; v_billed NUMERIC; v_spot NUMERIC;
  v_close_v  NUMERIC;
  v_prev     meter_cycles;
  v_desc     TEXT;
  v_total    NUMERIC := 0;
BEGIN
  SELECT * INTO v_c FROM meter_cycles WHERE id = p_cycle FOR UPDATE;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'Cycle not found.' USING ERRCODE = '22023'; END IF;
  IF NOT (is_platform_admin()
          OR (v_c.building_id IS NOT NULL AND user_can(v_c.building_id, 'expense.manage'))
          OR (v_c.compound_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM buildings b WHERE b.compound_id = v_c.compound_id AND user_can(b.id, 'expense.manage')))) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;

  -- ONE guard, three attacks (review 30 Aug): overlap, back-dating, and
  -- re-deriving a non-latest cycle (even after a client flipped its status
  -- to draft) - no OTHER final cycle may end inside or after this window.
  IF EXISTS (
    SELECT 1 FROM meter_cycles m WHERE m.expense_type_id = v_c.expense_type_id
      AND COALESCE(m.building_id, m.compound_id) = COALESCE(v_c.building_id, v_c.compound_id)
      AND m.status = 'final' AND m.id <> v_c.id
      AND m.period_end >= v_c.period_start) THEN
    RAISE EXCEPTION 'This window overlaps or predates a finalized cycle — cycles only advance forward. Recompute the latest cycle instead.' USING ERRCODE = 'P0001';
  END IF;
  -- legacy (v1, expense-backed) cycles are read-only history under v2:
  -- re-deriving one would leave its old expense + charges live (double bill)
  IF v_c.expense_id IS NOT NULL THEN
    RAISE EXCEPTION 'This cycle was posted by the old metering and is read-only. Delete it and re-enter the period under the new model if needed.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_s FROM meter_settings s
   WHERE s.expense_type_id = v_c.expense_type_id
     AND COALESCE(s.building_id, s.compound_id) = COALESCE(v_c.building_id, v_c.compound_id);
  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'Set up metering for this type first (model and purchase type).' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_type FROM expense_types WHERE id = v_c.expense_type_id;

  -- AHMAD'S PULL: type-bound, fund-paid, quantified, in window, not voided
  SELECT COALESCE(SUM(e.qty), 0), COALESCE(SUM(e.amount_usd), 0)
    INTO v_added_q, v_added_c
  FROM expenses e
  WHERE e.expense_type_id = v_s.purchase_expense_type_id
    AND e.qty IS NOT NULL
    AND e.voided_at IS NULL
    AND e.funded_by_fund_usd >= e.amount_usd - 0.005     -- fully fund-paid
    AND e.expense_date BETWEEN v_c.period_start AND v_c.period_end
    AND (e.building_id = v_c.building_id
         OR e.compound_id = v_c.compound_id
         OR (v_c.compound_id IS NOT NULL AND e.building_id IN (
               SELECT b.id FROM buildings b WHERE b.compound_id = v_c.compound_id)));

  -- opening: chain from the previous FINAL cycle; bridge rules apply
  SELECT * INTO v_prev FROM meter_cycles m
   WHERE m.expense_type_id = v_c.expense_type_id
     AND COALESCE(m.building_id, m.compound_id) = COALESCE(v_c.building_id, v_c.compound_id)
     AND m.status = 'final' AND m.id <> v_c.id AND m.period_end <= v_c.period_start
   ORDER BY m.period_end DESC LIMIT 1;

  v_open_q := v_c.opening_stock;   -- qty stays admin-entered (recounts tolerated)
  IF v_s.model = 'wa' THEN
    IF v_prev.id IS NOT NULL AND v_prev.model = 'wa' THEN
      -- rate-preserving: a recounted qty keeps the previous cycle's rate
      v_open_v := CASE WHEN v_prev.closing_stock > 0
        THEN ROUND(v_open_q * v_prev.closing_stock_value / v_prev.closing_stock, 2)
        ELSE 0 END;
    ELSIF v_prev.id IS NOT NULL THEN
      v_open_v := 0;   -- MbM→WA bridge: residents already paid for the tank
    ELSE
      v_open_v := v_s.initial_stock_value;   -- brand-new WA setup, asked once
    END IF;
  ELSE
    v_open_v := 0;
  END IF;

  v_close_q  := v_c.closing_stock;
  v_consumed := v_open_q + v_added_q - v_close_q;

  -- guards
  IF v_close_q > v_open_q + v_added_q + 0.0005 THEN
    RAISE EXCEPTION 'Closing stock exceeds opening + purchases — check the readings or a missing invoice.' USING ERRCODE = 'P0001';
  END IF;
  IF v_added_q <= 0 AND v_close_q > v_open_q THEN
    RAISE EXCEPTION 'The stock rose but no matching purchase invoice was found — check the expense type on the delivery.' USING ERRCODE = 'P0001';
  END IF;
  IF v_consumed <= 0 THEN
    RAISE EXCEPTION 'Nothing was consumed this period — nothing to bill.' USING ERRCODE = 'P0001';
  END IF;

  -- meters
  SELECT COALESCE(SUM(GREATEST(0, r.end_reading - r.start_reading)) FILTER (WHERE r.unit_id IS NOT NULL), 0),
         COALESCE(SUM(GREATEST(0, r.end_reading - r.start_reading)) FILTER (WHERE r.unit_id IS NULL), 0)
    INTO v_meters, v_common
  FROM meter_readings r
  WHERE r.cycle_id = p_cycle
    AND (r.unit_id IS NULL OR EXISTS (
          SELECT 1 FROM units u WHERE u.id = r.unit_id AND u.deleted_at IS NULL));
  IF v_meters + v_common <= 0 THEN
    RAISE EXCEPTION 'No meter readings — nothing to allocate against.' USING ERRCODE = 'P0001';
  END IF;

  v_losses := v_consumed - (v_meters + v_common);
  IF v_losses < -0.0005 THEN
    RAISE EXCEPTION 'The meters read MORE than the tank released (% vs %) — a reading or stock figure is wrong.',
      ROUND(v_meters + v_common, 3), ROUND(v_consumed, 3) USING ERRCODE = 'P0001';
  END IF;
  v_loss_pct := CASE WHEN v_consumed > 0 THEN 100.0 * v_losses / v_consumed ELSE 0 END;
  IF v_loss_pct > v_s.loss_alarm_pct AND NOT p_confirm_losses THEN
    RAISE EXCEPTION 'LOSSES_ALARM|%', ROUND(v_loss_pct, 1) USING ERRCODE = 'P0001';
  END IF;

  -- rates (losses grossed into the billed rate, both models)
  IF v_s.model = 'wa' THEN
    IF v_open_q + v_added_q <= 0 THEN
      RAISE EXCEPTION 'No stock and no purchases — the rate is undefined.' USING ERRCODE = 'P0001';
    END IF;
    v_rate  := (v_open_v + v_added_c) / (v_open_q + v_added_q);
    v_pool  := ROUND(v_consumed * v_rate, 2);
    v_close_v := ROUND(v_close_q * v_rate, 2);
  ELSE
    v_pool  := v_added_c;
    v_rate  := NULL;
    v_close_v := 0;
  END IF;
  IF v_pool <= 0 AND v_s.model <> 'wa' THEN
    RAISE EXCEPTION 'Nothing to bill: no purchases in this window.' USING ERRCODE = 'P0001';
  END IF;
  v_billed := v_pool / (v_meters + v_common);
  v_spot   := CASE WHEN v_added_q > 0 THEN v_added_c / v_added_q ELSE NULL END;

  v_desc := COALESCE(v_type.name, 'Metered') || ' · ' ||
            to_char(v_c.period_start, 'DD-MM') || ' – ' || to_char(v_c.period_end, 'DD-MM-YYYY');

  -- re-finalize: the previous derivation's charges go, wholesale
  DELETE FROM charges WHERE meter_cycle_id = p_cycle;

  -- charges: own consumption + the common pool split by the settings method
  WITH ur AS (
    SELECT r.unit_id, GREATEST(0, r.end_reading - r.start_reading) AS delta
    FROM meter_readings r WHERE r.cycle_id = p_cycle AND r.unit_id IS NOT NULL
  ),
  scope_units AS (
    SELECT u.id, u.building_id, u.share_weight FROM units u
    WHERE u.deleted_at IS NULL
      AND (u.building_id = v_c.building_id
           OR (v_c.compound_id IS NOT NULL AND u.building_id IN (
                 SELECT b.id FROM buildings b WHERE b.compound_id = v_c.compound_id)))
  ),
  w AS (SELECT COALESCE(SUM(share_weight), 0) AS tw, COUNT(*) AS n FROM scope_units),
  rows_ AS (
    SELECT su.id AS unit_id, su.building_id,
      ROUND(COALESCE(ur.delta, 0) * v_billed, 2)
      + COALESCE(ROUND(v_common * v_billed * CASE WHEN v_s.common_method = 'equal'
          THEN 1.0 / NULLIF(w.n, 0)
          ELSE su.share_weight / NULLIF(w.tw, 0) END, 2), 0) AS amount
    FROM scope_units su CROSS JOIN w
    LEFT JOIN ur ON ur.unit_id = su.id
  )
  INSERT INTO charges (meter_cycle_id, unit_id, building_id, category, description,
                       amount_usd, charge_date, billed_to, tenant_id, created_by)
  SELECT p_cycle, r.unit_id, r.building_id,
         COALESCE(v_type.key, 'other'), v_desc, r.amount, v_c.period_end,
         CASE WHEN v_s.billed_to = 'tenant_where_leased' AND tn.user_id IS NOT NULL THEN 'tenant' ELSE 'owner' END,
         CASE WHEN v_s.billed_to = 'tenant_where_leased' THEN tn.user_id END,
         auth.uid()
  FROM rows_ r
  LEFT JOIN LATERAL (
    SELECT m.user_id FROM memberships m
    WHERE m.unit_id = r.unit_id AND m.tenure = 'tenant' AND m.ended_at IS NULL
    ORDER BY m.created_at DESC LIMIT 1
  ) tn ON TRUE
  WHERE r.amount > 0;

  SELECT COALESCE(SUM(amount_usd), 0) INTO v_total FROM charges WHERE meter_cycle_id = p_cycle;

  -- 0175: per-unit ROUND() drifts the sum a few cents off v_pool (the exact
  -- intended total - purchases for MbM, consumed*rate for WA). Books must tie
  -- to the cent: hand the remainder to the largest charge, like allocate()
  -- does for plain expenses. Bounded so only genuine rounding drift moves.
  IF v_total > 0 AND v_pool - v_total <> 0 AND ABS(v_pool - v_total) <= 0.5 THEN
    UPDATE charges SET amount_usd = amount_usd + (v_pool - v_total)
     WHERE id = (SELECT id FROM charges WHERE meter_cycle_id = p_cycle
                  ORDER BY amount_usd DESC, id LIMIT 1);
    v_total := v_pool;
  END IF;

  UPDATE meter_cycles SET
    status = 'final', model = v_s.model, purchase_type_id = v_s.purchase_expense_type_id,
    added_qty = v_added_q, added_cost_usd = v_added_c,
    opening_stock_value = v_open_v, closing_stock_value = v_close_v,
    rate_billed = ROUND(v_billed, 6), rate_spot = ROUND(v_spot, 6),
    losses_qty = ROUND(v_losses, 3),
    common_method = v_s.common_method, billed_to = v_s.billed_to
  WHERE id = p_cycle;

  RETURN v_total;
END;
$function$
;
