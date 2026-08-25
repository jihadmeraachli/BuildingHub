-- ============================================================
-- 0141_issue_budget_mode_guard.sql
-- DUES audit D13 (Ahmad-approved): issue_budget() never checked that the scope
-- is actually in DUES billing mode. A direct RPC call could plant dues on an
-- ARREARS building/compound, where get_overdue_dues (mode='dues' filter) would
-- never chase them — silent orphan obligations. The UI gates on mode, but the
-- server should too. Reject when the scope's effective mode isn't 'dues'.
--
-- Body is 0136's verbatim + one guard. Additive & idempotent.
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
  -- 0141 (D13): a budget only makes sense in dues mode. A compound's mode wins
  -- over its blocks (effective_billing_mode), so check the compound directly.
  IF (v_building IS NOT NULL AND effective_billing_mode(v_building) <> 'dues')
     OR (v_compound IS NOT NULL AND COALESCE((SELECT billing_mode FROM compounds WHERE id = v_compound), 'arrears') <> 'dues') THEN
    RAISE EXCEPTION 'Budgets can only be issued for a scope in dues billing mode.' USING ERRCODE = '42501';
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

-- Post-run check:
--   Try issue_budget on an arrears-mode building/compound (direct RPC) → 42501
--     'Budgets can only be issued for a scope in dues billing mode.'
--   Normal dues-mode issuance → unchanged.
