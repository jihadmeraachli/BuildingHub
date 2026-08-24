-- ============================================================
-- 0128_fix_repost_expense_scope.sql
-- SECURITY FIX (audit C1, CRITICAL): repost_expense() wrote charges onto
-- any unit in any building.
--
-- THE HOLE. repost_expense (0121) is SECURITY DEFINER, so charges RLS does
-- not run inside it. It checks the caller has expense.manage on the EXPENSE's
-- building/compound, then inserted charges taking unit_id AND building_id
-- straight from the client payload (p_rows) with no check that those units
-- belong to the expense's scope. Any building_admin of one building could
-- call the RPC by hand with another building's unit ids and write real
-- charges onto units they do not manage — straight past RLS, and silently
-- (notify_suppressed = TRUE means the victim gets no in-app/email alert).
--
-- This is exactly the class 0093 closed for repost_metered_expense. 0121 was
-- written after 0093, cites it in its header, but never mirrored the guard.
--
-- THE FIX (mirrors 0093 exactly):
--   1. Reject the whole call if any row's unit is unknown or outside the
--      expense's building / a block of its compound — BEFORE any write.
--   2. Derive building_id from units.building_id, never from the payload.
-- Everything else (party preservation, voided-row protection, notify
-- suppression, single transaction) is unchanged from 0121.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION repost_expense(
  p_expense UUID, p_fields JSONB, p_rows JSONB, p_default_leased_to TEXT DEFAULT 'owner'
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_e RECORD;
  v_category TEXT; v_description TEXT; v_date DATE;
BEGIN
  SELECT * INTO v_e FROM expenses WHERE id = p_expense;
  IF v_e IS NULL THEN
    RAISE EXCEPTION 'Expense not found.' USING ERRCODE = '22023';
  END IF;
  IF v_e.meter_cycle_id IS NOT NULL THEN
    RAISE EXCEPTION 'This expense was posted by a metering cycle — edit the cycle, which recomputes and re-posts.'
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT (is_platform_admin()
          OR (v_e.building_id IS NOT NULL AND user_can(v_e.building_id, 'expense.manage'))
          OR (v_e.compound_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM buildings b WHERE b.compound_id = v_e.compound_id AND user_can(b.id, 'expense.manage')))) THEN
    RAISE EXCEPTION 'Not allowed to re-post this expense.' USING ERRCODE = '42501';
  END IF;

  -- 0128 (0093-style scope guard): an unknown unit, or one outside this
  -- expense's building or compound, kills the whole call before any write.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) AS r
    LEFT JOIN units     u ON u.id = (r->>'unit_id')::UUID
    LEFT JOIN buildings b ON b.id = u.building_id
    WHERE u.id IS NULL
       OR NOT ((v_e.building_id IS NOT NULL AND u.building_id = v_e.building_id)
               OR (v_e.compound_id IS NOT NULL AND b.compound_id = v_e.compound_id))
  ) THEN
    RAISE EXCEPTION 'A charge targets a unit outside this expense''s building or compound.'
      USING ERRCODE = '42501';
  END IF;

  v_category    := COALESCE(p_fields->>'category', v_e.category);
  v_description := COALESCE(p_fields->>'description', v_e.description);
  v_date        := COALESCE((p_fields->>'expense_date')::DATE, v_e.expense_date);

  UPDATE expenses SET
    category           = v_category,
    expense_type_id    = NULLIF(p_fields->>'expense_type_id', '')::UUID,
    description        = v_description,
    amount_usd         = COALESCE((p_fields->>'amount_usd')::NUMERIC, amount_usd),
    amount_lbp         = NULLIF(p_fields->>'amount_lbp', '')::NUMERIC,
    lbp_rate           = NULLIF(p_fields->>'lbp_rate', '')::NUMERIC,
    expense_date       = v_date,
    scope_type         = COALESCE(p_fields->>'scope_type', scope_type),
    method             = COALESCE(p_fields->>'method', method),
    funded_by_fund_usd = COALESCE((p_fields->>'funded_by_fund_usd')::NUMERIC, funded_by_fund_usd),
    project_id         = NULLIF(p_fields->>'project_id', '')::UUID,
    amenity_id         = NULLIF(p_fields->>'amenity_id', '')::UUID,
    invoice_url        = COALESCE(p_fields->>'invoice_url', invoice_url)
  WHERE id = p_expense;

  CREATE TEMP TABLE IF NOT EXISTS _prior_party ON COMMIT DROP AS
    SELECT unit_id, billed_to, tenant_id FROM charges
    WHERE expense_id = p_expense AND voided_at IS NULL;

  DELETE FROM charges WHERE expense_id = p_expense AND voided_at IS NULL;

  WITH resolved AS (
    SELECT
      u.id AS unit_id,
      u.building_id AS building_id,          -- 0128: from the UNIT, not the payload
      (r->>'amount_usd')::NUMERIC AS amount_usd,
      COALESCE(pp.billed_to,
               CASE WHEN p_default_leased_to = 'tenant' AND EXISTS (
                      SELECT 1 FROM memberships m WHERE m.unit_id = u.id
                        AND m.tenure = 'tenant' AND m.ended_at IS NULL)
                    THEN 'tenant' ELSE 'owner' END) AS billed_to,
      pp.tenant_id AS prior_tenant_id
    FROM jsonb_array_elements(p_rows) AS r
    JOIN units u ON u.id = (r->>'unit_id')::UUID
    LEFT JOIN _prior_party pp ON pp.unit_id = u.id
  )
  INSERT INTO charges (expense_id, unit_id, building_id, category, description, amount_usd,
                       charge_date, billed_to, tenant_id, created_by, notify_suppressed)
  SELECT
    p_expense, resolved.unit_id, resolved.building_id, v_category, v_description,
    resolved.amount_usd, v_date, resolved.billed_to,
    CASE WHEN resolved.billed_to <> 'tenant' THEN NULL
         WHEN resolved.prior_tenant_id IS NOT NULL THEN resolved.prior_tenant_id
         ELSE (SELECT m.user_id FROM memberships m WHERE m.unit_id = resolved.unit_id
                 AND m.tenure = 'tenant' AND m.ended_at IS NULL
                 ORDER BY m.created_at DESC LIMIT 1)
    END,
    auth.uid(),
    TRUE
  FROM resolved;
END;
$$;

COMMIT;

-- Post-run checks:
--   Normal edit (own building's expense) → charges rebuilt as before, no dup emails.
--   Craft a p_rows with a unit id from ANOTHER building → the call is rejected
--     with 42501 'A charge targets a unit outside this expense's building or compound.'
--   Voided charges on the expense remain untouched.
