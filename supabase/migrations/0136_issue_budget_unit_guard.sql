-- ============================================================
-- 0136_issue_budget_unit_guard.sql
-- HARDENING (audit L2, low): issue_budget() validated each dues row's
-- building_id against the budget's scope, but never that the row's unit_id
-- actually belongs to that building_id. A caller with charge.manage on their
-- own building could set building_id = own (passes) but unit_id = a stranger's
-- unit, planting a bogus dues obligation on it. No money moves (dues are
-- obligations, not ledger entries), so it is low — a harassing "amount due"
-- notice — but it is the same class as C1 and cheap to close.
--
-- FIX. One added guard: every dues row's unit must exist and belong to the
-- row's building. Body is 0125's verbatim otherwise. Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION issue_budget(p_budget JSONB, p_lines JSONB, p_dues JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_building UUID := NULLIF(p_budget->>'building_id', '')::UUID;
  v_compound UUID := NULLIF(p_budget->>'compound_id', '')::UUID;
  v_id UUID;
BEGIN
  IF NOT (is_platform_admin()
          OR (v_building IS NOT NULL AND user_can(v_building, 'charge.manage'))
          OR (v_compound IS NOT NULL AND EXISTS (
                SELECT 1 FROM buildings b WHERE b.compound_id = v_compound AND user_can(b.id, 'charge.manage')))) THEN
    RAISE EXCEPTION 'Not allowed to issue a budget here.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'A budget needs at least one line.' USING ERRCODE = '22023';
  END IF;
  -- 0093-style scope guard: every dues row must land inside the budget's scope.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_dues, '[]'::jsonb)) d
    WHERE NOT (
      (v_building IS NOT NULL AND (d->>'building_id')::UUID = v_building)
      OR (v_compound IS NOT NULL AND EXISTS (
            SELECT 1 FROM buildings b WHERE b.id = (d->>'building_id')::UUID AND b.compound_id = v_compound))
    )
  ) THEN
    RAISE EXCEPTION 'A dues row targets a building outside this budget''s scope.' USING ERRCODE = '42501';
  END IF;
  -- 0136: and every dues row's unit must actually belong to its building.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_dues, '[]'::jsonb)) d
    LEFT JOIN units u ON u.id = (d->>'unit_id')::UUID
    WHERE u.id IS NULL OR u.building_id <> (d->>'building_id')::UUID
  ) THEN
    RAISE EXCEPTION 'A dues row targets a unit outside its building.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO budgets (building_id, compound_id, label, period_start, period_end, due_date,
                       method, billed_to, true_up, expense_id, created_by)
  VALUES (v_building, v_compound, p_budget->>'label',
          (p_budget->>'period_start')::DATE, (p_budget->>'period_end')::DATE,
          NULLIF(p_budget->>'due_date', '')::DATE,
          COALESCE(p_budget->>'method', 'by_shares'),
          COALESCE(p_budget->>'billed_to', 'tenant_where_leased'),
          COALESCE((p_budget->>'true_up')::BOOLEAN, TRUE),
          NULLIF(p_budget->>'expense_id', '')::UUID,
          auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO budget_lines (budget_id, expense_type_id, note, amount_usd, amount_lbp, lbp_rate)
  SELECT v_id,
         NULLIF(l->>'expense_type_id', '')::UUID,
         NULLIF(l->>'note', ''),
         (l->>'amount_usd')::NUMERIC,
         NULLIF(l->>'amount_lbp', '')::NUMERIC,
         NULLIF(l->>'lbp_rate', '')::NUMERIC
  FROM jsonb_array_elements(p_lines) l;

  INSERT INTO dues (plan_id, budget_id, building_id, unit_id, period_label, due_date,
                    base_amount, carry_in, amount_due, billed_to, tenant_id, kind, label, created_by)
  SELECT NULL, v_id,
         (d->>'building_id')::UUID, (d->>'unit_id')::UUID,
         d->>'period_label', NULLIF(d->>'due_date', '')::DATE,
         (d->>'base_amount')::NUMERIC, COALESCE((d->>'carry_in')::NUMERIC, 0), (d->>'amount_due')::NUMERIC,
         COALESCE(d->>'billed_to', 'owner'), NULLIF(d->>'tenant_id', '')::UUID,
         COALESCE(d->>'kind', 'recurring'), NULLIF(d->>'label', ''),
         auth.uid()
  FROM jsonb_array_elements(COALESCE(p_dues, '[]'::jsonb)) d;

  RETURN v_id;
END;
$$;

COMMIT;

-- Post-run checks:
--   Issue a normal budget with dues for your own building's units → works.
--   Craft a dues row with a unit_id from another building → 42501, rejected.
