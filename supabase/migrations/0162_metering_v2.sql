-- ============================================================
-- 0162_metering_v2.sql
-- Metering v2 (Jey + Ahmad + Claude, agreed 2026-08-29): two models,
-- typed purchase pull, server-side finalize, stock in the fund view.
--
-- THE MODELS (chosen per metered type in meter_settings, snapshotted onto
-- each cycle - changing the setting never rewrites a posted cycle):
--   'mbm'  Month by Month: bills the window's PURCHASES, split over what the
--          meters measured. Money in = money out; the fund never carries
--          fuel value; losses are inherently shared (pool ÷ measured).
--   'wa'   Weighted Average: bills CONSUMPTION at the rolling average cost.
--          rate = (opening value + purchases value) ÷ (opening qty + bought
--          qty); closing value = closing qty × rate → next cycle's opening.
--          The tank is fund money: fund_position gains stock_on_hand.
--
-- AHMAD'S RULE - the purchase pull is TYPE-BOUND, never a date sweep:
--   purchases = expenses of settings.purchase_expense_type_id (defaults to
--   the metered type), fund-paid, WITH a quantity, inside the window, not
--   voided. Repairs and contracts are ordinary expenses and structurally
--   invisible here. expenses.qty is the new-style marker: legacy
--   cycle-posted expenses have no qty and can never be double-pulled.
--
-- THE CYCLE POSTS CHARGES ONLY - no expense. The purchase invoices ARE the
-- expenses (cash out); the cycle turns consumption into unit charges. This
-- fixes the old drift where the posted expense (consumed value) diverged
-- from the cash actually spent (purchase value).
--
-- SWITCHING RULES (deep dive 2026-08-29):
--   1. MbM→WA bridge: opening VALUE forced to 0 - residents already paid
--      for the tank under MbM; the blended rate returns their prepayment
--      exactly. Only a brand-new WA setup may carry an initial value
--      (settings.initial_*, asked once: "was the tank already billed?").
--   2. WA→MbM: gated in the app - stock value must be ~0 or written off.
--   3. Chain protection: only the LATEST final cycle may be re-finalized or
--      deleted; purchases inside a FINALIZED window are void-locked.
--   4. Losses: GROSS-UP (billed rate = pool ÷ Σ meters); finalize refuses
--      above settings.loss_alarm_pct without p_confirm_losses.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;
SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------------------
-- 1. Columns + settings.
-- ------------------------------------------------------------
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS qty NUMERIC(14,3);
COMMENT ON COLUMN expenses.qty IS
  'Quantity (liters / m³) for a metering purchase expense. NULL = ordinary expense, invisible to metering pulls (0162).';

ALTER TABLE meter_cycles ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE meter_cycles ADD COLUMN IF NOT EXISTS purchase_type_id UUID REFERENCES expense_types(id) ON DELETE SET NULL;
ALTER TABLE meter_cycles ADD COLUMN IF NOT EXISTS opening_stock_value NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE meter_cycles ADD COLUMN IF NOT EXISTS closing_stock_value NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE meter_cycles ADD COLUMN IF NOT EXISTS rate_billed NUMERIC(14,6);
ALTER TABLE meter_cycles ADD COLUMN IF NOT EXISTS rate_spot   NUMERIC(14,6);
ALTER TABLE meter_cycles ADD COLUMN IF NOT EXISTS losses_qty  NUMERIC(14,3);
ALTER TABLE meter_cycles DROP CONSTRAINT IF EXISTS meter_cycles_model_chk;
ALTER TABLE meter_cycles ADD CONSTRAINT meter_cycles_model_chk CHECK (model IS NULL OR model IN ('mbm', 'wa'));

CREATE TABLE IF NOT EXISTS meter_settings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id              UUID REFERENCES buildings(id) ON DELETE CASCADE,
  compound_id              UUID REFERENCES compounds(id) ON DELETE CASCADE,
  expense_type_id          UUID NOT NULL REFERENCES expense_types(id) ON DELETE CASCADE,
  model                    TEXT NOT NULL DEFAULT 'mbm' CHECK (model IN ('mbm', 'wa')),
  purchase_expense_type_id UUID NOT NULL REFERENCES expense_types(id) ON DELETE RESTRICT,
  loss_alarm_pct           NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (loss_alarm_pct >= 0 AND loss_alarm_pct <= 100),
  billed_to                TEXT NOT NULL DEFAULT 'tenant_where_leased' CHECK (billed_to IN ('tenant_where_leased', 'owner')),
  common_method            TEXT NOT NULL DEFAULT 'by_shares' CHECK (common_method IN ('equal', 'by_shares')),
  -- brand-new WA setup only: the counted tank + whether residents already
  -- paid for it (already billed → value 0). Used by the FIRST final cycle.
  initial_stock_qty        NUMERIC(14,3) NOT NULL DEFAULT 0,
  initial_stock_value      NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by               UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meter_settings_scope CHECK ((building_id IS NOT NULL) <> (compound_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS meter_settings_building_uidx
  ON meter_settings(building_id, expense_type_id) WHERE building_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS meter_settings_compound_uidx
  ON meter_settings(compound_id, expense_type_id) WHERE compound_id IS NOT NULL;

ALTER TABLE meter_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meter_settings_select ON meter_settings;
CREATE POLICY meter_settings_select ON meter_settings FOR SELECT USING (
  is_platform_admin()
  OR (building_id IS NOT NULL AND user_can(building_id, 'finance.view'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = meter_settings.compound_id
          AND user_can(b.id, 'finance.view')))
);
DROP POLICY IF EXISTS meter_settings_write ON meter_settings;
CREATE POLICY meter_settings_write ON meter_settings FOR ALL USING (
  is_platform_admin()
  OR (building_id IS NOT NULL AND user_can(building_id, 'expense.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = meter_settings.compound_id
          AND user_can(b.id, 'expense.manage')))
) WITH CHECK (
  is_platform_admin()
  OR (building_id IS NOT NULL AND user_can(building_id, 'expense.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = meter_settings.compound_id
          AND user_can(b.id, 'expense.manage')))
);

-- ------------------------------------------------------------
-- 2. The finalize door: SERVER is the source of truth. The client's
--    computeMeterCycle is the PREVIEW twin of this math.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION finalize_meter_cycle(p_cycle UUID, p_confirm_losses BOOLEAN DEFAULT FALSE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
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

  -- chain protection: a FINAL cycle may only be re-derived while it is the
  -- latest one of its type in scope (WA values chain forward)
  IF v_c.status = 'final' AND EXISTS (
    SELECT 1 FROM meter_cycles m WHERE m.expense_type_id = v_c.expense_type_id
      AND COALESCE(m.building_id, m.compound_id) = COALESCE(v_c.building_id, v_c.compound_id)
      AND m.status = 'final' AND m.period_end > v_c.period_end) THEN
    RAISE EXCEPTION 'Later cycles exist — only the latest cycle can be recomputed.' USING ERRCODE = 'P0001';
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
  FROM meter_readings r WHERE r.cycle_id = p_cycle;
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
  IF v_pool <= 0 THEN
    RAISE EXCEPTION 'Nothing to bill: the pool is zero.' USING ERRCODE = 'P0001';
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
      + ROUND(v_common * v_billed * CASE WHEN v_s.common_method = 'equal'
          THEN 1.0 / NULLIF(w.n, 0)
          ELSE su.share_weight / NULLIF(w.tw, 0) END, 2) AS amount
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

  UPDATE meter_cycles SET
    status = 'final', model = v_s.model, purchase_type_id = v_s.purchase_expense_type_id,
    added_qty = v_added_q, added_cost_usd = v_added_c,
    opening_stock_value = v_open_v, closing_stock_value = v_close_v,
    rate_billed = ROUND(v_billed, 6), rate_spot = ROUND(v_spot, 6),
    losses_qty = ROUND(v_losses, 3),
    common_method = v_s.common_method, billed_to = v_s.billed_to
  WHERE id = p_cycle;
END;
$$;
GRANT EXECUTE ON FUNCTION finalize_meter_cycle(UUID, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 3. delete_meter_cycle: v2 cycles carry charges directly (no expense);
--    chain protection applies (0092 body + both).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_meter_cycle(p_cycle UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_c RECORD;
BEGIN
  SELECT * INTO v_c FROM meter_cycles WHERE id = p_cycle;
  IF v_c IS NULL THEN
    RAISE EXCEPTION 'Cycle not found.' USING ERRCODE = '22023';
  END IF;
  IF NOT (is_platform_admin()
          OR (v_c.building_id IS NOT NULL AND user_can(v_c.building_id, 'expense.manage'))
          OR (v_c.compound_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM buildings b WHERE b.compound_id = v_c.compound_id AND user_can(b.id, 'expense.manage')))) THEN
    RAISE EXCEPTION 'Not allowed to delete this cycle.' USING ERRCODE = '42501';
  END IF;
  -- WA values chain forward: only the latest final cycle may go
  IF v_c.status = 'final' AND EXISTS (
    SELECT 1 FROM meter_cycles m WHERE m.expense_type_id = v_c.expense_type_id
      AND COALESCE(m.building_id, m.compound_id) = COALESCE(v_c.building_id, v_c.compound_id)
      AND m.status = 'final' AND m.period_end > v_c.period_end) THEN
    RAISE EXCEPTION 'Later cycles exist — delete from the latest backwards.' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM charges WHERE meter_cycle_id = p_cycle;      -- v2 cycles
  IF v_c.expense_id IS NOT NULL THEN
    DELETE FROM expenses WHERE id = v_c.expense_id;        -- legacy cycles
  END IF;
  DELETE FROM meter_cycles WHERE id = p_cycle;
END;
$$;
GRANT EXECUTE ON FUNCTION delete_meter_cycle(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 4. void_expense learns the purchase lock (0161 verbatim + the guard):
--    a purchase consumed by a FINALIZED cycle is frozen - fix via an
--    adjustment, or delete the cycle first (latest-backwards).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION void_expense(p_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_exp expenses;
BEGIN
  SELECT * INTO v_exp FROM expenses WHERE id = p_id FOR UPDATE;
  IF v_exp.id IS NULL THEN RAISE EXCEPTION 'Expense not found.' USING ERRCODE = '22023'; END IF;
  IF NOT (is_platform_admin()
    OR (v_exp.building_id IS NOT NULL AND user_can(v_exp.building_id, 'expense.manage'))
    OR (v_exp.compound_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM buildings b WHERE b.compound_id = v_exp.compound_id
            AND user_can(b.id, 'expense.manage')))) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  IF v_exp.meter_cycle_id IS NOT NULL THEN
    RAISE EXCEPTION 'This expense was posted by a metering cycle — manage it from the Metering tab.'
      USING ERRCODE = 'P0001';
  END IF;
  -- 0162: purchase lock - a quantified purchase inside a finalized cycle's
  -- window already priced a rate that charged residents
  IF v_exp.qty IS NOT NULL AND EXISTS (
    SELECT 1 FROM meter_cycles mc
    JOIN meter_settings ms ON ms.expense_type_id = mc.expense_type_id
      AND COALESCE(ms.building_id, ms.compound_id) = COALESCE(mc.building_id, mc.compound_id)
    WHERE ms.purchase_expense_type_id = v_exp.expense_type_id
      AND mc.status = 'final'
      AND v_exp.expense_date BETWEEN mc.period_start AND mc.period_end
      AND (v_exp.building_id = mc.building_id
           OR v_exp.compound_id = mc.compound_id
           OR (mc.compound_id IS NOT NULL AND v_exp.building_id IN (
                 SELECT b.id FROM buildings b WHERE b.compound_id = mc.compound_id)))) THEN
    RAISE EXCEPTION 'This purchase was consumed by a finalized metering cycle — correct via an adjustment, or recompute the cycle.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_exp.voided_at IS NOT NULL THEN RETURN; END IF;

  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT DISTINCT m.user_id, c.building_id, 'expense_voided',
         'Charges removed', v_exp.description || ' — it no longer appears on your statement.'
  FROM charges c
  JOIN memberships m ON m.unit_id = c.unit_id AND m.ended_at IS NULL
  WHERE c.expense_id = p_id AND c.voided_at IS NULL
    AND ((c.billed_to = 'tenant' AND m.tenure = 'tenant'
            AND (c.tenant_id IS NULL OR m.user_id = c.tenant_id))
      OR (c.billed_to <> 'tenant' AND m.tenure = 'owner'));

  UPDATE charges SET voided_at = now(), voided_by = auth.uid(), void_reason = 'Expense voided'
   WHERE expense_id = p_id AND voided_at IS NULL;
  UPDATE payment_request_lines l SET cancelled_at = now()
    FROM payment_requests r
   WHERE r.id = l.request_id AND r.expense_id = p_id AND l.cancelled_at IS NULL;
  UPDATE expenses SET voided_at = now(), voided_by = auth.uid(), void_reason = NULLIF(btrim(COALESCE(p_reason, '')), '')
   WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION void_expense(UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 5. fund_position: stock_on_hand joins the outputs (WA cycles only;
--    latest FINAL closing value per type per scope). Reserve formula is
--    deliberately UNCHANGED - the stock is a separate visible line.
--    (Function body otherwise identical to 0161.)
-- ------------------------------------------------------------
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
  unreconciled  INT,
  cash_usd      NUMERIC,
  cash_lbp      NUMERIC,
  unattributed  INT,
  stock_on_hand NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_seen      UUID[];
  v_ids       UUID[];
  v_comp      UUID[];
  v_blockcomp UUID[];
  v_to        DATE := COALESCE(p_to, CURRENT_DATE);
BEGIN
  SELECT array_agg(id) INTO v_seen
  FROM unnest(p_building_ids) AS id
  WHERE is_platform_admin() OR user_can(id, 'finance.view') OR user_member_building(id);
  IF v_seen IS NULL THEN RETURN; END IF;

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
            (f.building_id = ANY(v_ids) AND f.building_id IN (
               SELECT b.id FROM buildings b LEFT JOIN compounds c ON c.id = b.compound_id
               WHERE b.compound_id IS NULL OR c.fund_scope = 'block'))
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
    SELECT COALESCE(SUM(x.amount_usd), 0) AS v,
           COALESCE(SUM(x.funded_by_fund_usd), 0) AS fp,
           COALESCE(SUM(ROUND(x.amount_usd - COALESCE(x.amount_lbp / NULLIF(x.lbp_rate, 0), 0), 2)), 0) AS usd,
           COALESCE(SUM(COALESCE(x.amount_lbp, 0)), 0) AS lbp
    FROM expenses x
    WHERE x.expense_date <= v_to
      AND x.voided_at IS NULL
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
      AND x.voided_at IS NULL
      AND (COALESCE(x.paid_from_building_id, x.building_id) = ANY(v_ids)
           OR (v_comp IS NOT NULL AND x.compound_id = ANY(v_comp)))
      AND ABS(x.amount_usd - COALESCE(c.billed, 0) - x.funded_by_fund_usd) > 0.005
  ),
  unattr AS (
    SELECT (COALESCE((SELECT COUNT(*) FROM expenses x
              WHERE v_blockcomp IS NOT NULL AND x.compound_id = ANY(v_blockcomp)
                AND x.building_id IS NULL AND x.paid_from_building_id IS NULL
                AND x.voided_at IS NULL
                AND x.expense_date <= v_to), 0)
          + COALESCE((SELECT COUNT(*) FROM fund_entries e
              WHERE v_blockcomp IS NOT NULL AND e.compound_id = ANY(v_blockcomp)
                AND e.building_id IS NULL AND e.voided_at IS NULL
                AND e.entry_date <= v_to), 0))::int AS n
  ),
  stock AS (
    -- 0162: latest FINAL WA cycle per metered type per scope, as of the cut
    SELECT COALESCE(SUM(x.cv), 0) AS v FROM (
      SELECT DISTINCT ON (mc.expense_type_id, COALESCE(mc.building_id, mc.compound_id))
             mc.closing_stock_value AS cv
      FROM meter_cycles mc
      WHERE mc.status = 'final' AND mc.model = 'wa' AND mc.period_end <= v_to
        AND (mc.building_id = ANY(v_ids)
             OR (v_comp IS NOT NULL AND mc.compound_id = ANY(v_comp)))
      ORDER BY mc.expense_type_id, COALESCE(mc.building_id, mc.compound_id), mc.period_end DESC
    ) x
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
    unattr.n,
    ROUND(stock.v, 2)                                                             AS stock_on_hand
  FROM op, pin, oin, exo, oout, ref, bal, unrec, unattr, stock;
END;
$$;
GRANT EXECUTE ON FUNCTION fund_position(UUID[], DATE) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   1. Set up a metered type (model, purchase type) → record a fund-paid
--      purchase WITH qty under that type → draft a cycle spanning it →
--      finalize: charges land with meter_cycle_id and NO expense; the cycle
--      stores billed/spot rates and losses. A repair expense in the same
--      window changes nothing.
--   2. WA: second cycle's opening value = first's closing value; recounted
--      opening qty keeps the rate. A building switching MbM→WA gets opening
--      value 0 (prior cycle model mbm).
--   3. Losses above the alarm → 'LOSSES_ALARM|<pct>'; retry with
--      p_confirm_losses := true posts.
--   4. Voiding a pulled purchase after finalize → refused (purchase lock);
--      delete_meter_cycle refuses non-latest final cycles.
--   5. fund_position.stock_on_hand = the WA closing value; reserve formula
--      unchanged (verify identity probe still holds).
-- ============================================================
