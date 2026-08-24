-- ============================================================
-- 0125_finance_audit_tail.sql — finance audit findings M3, M4, L1.
-- (M1/M2/M5/L3 are client-side, shipped in the same commit as this file.)
--
-- M3. Budget issuance was three sequential client inserts (budgets →
-- budget_lines → dues) with no rollback: a mid-flight failure left a budget
-- shown as issued at $0, or dues without lines. The exact class 0092 closed
-- for CANCEL (cancel_budget) but never for ISSUE. issue_budget() below is
-- the issue-side twin: one SECURITY DEFINER function, one transaction. Used
-- by both the Dues page's Issue budget and Finance's extraordinary-expense
-- dues branch. The dues INSERTs still fire the notify triggers, exactly as
-- the client inserts did — residents keep getting their dues notices.
--
-- M4. dues_select admitted user_member_building: EVERY resident could read
-- EVERY unit's dues rows, whose carry_in derives from each neighbour's
-- private balance — the same information 0097 spent a migration hiding on
-- charges/payments/adjustments. 0097's own comment parked this as "needs a
-- product decision". Decision taken here by following 0097's own precedent:
-- a resident sees their OWN dues (owner: all of the unit's; tenant: the
-- tenant-billed ones), managers see everything, neighbours see nothing.
-- If building-wide dues transparency is ever wanted as a product feature,
-- this is one policy to revert — nothing else depends on it.
--
-- L1. get_overdue_dues could return rows whose recipient array was empty
-- (an owner membership that ended), and send-reminders inserts the
-- reminders_sent dedup row BEFORE looping recipients — so the audit trail
-- recorded daily "reminders sent" that reached no one. 0088 added the
-- "nobody to notify → not a candidate" guard to the ARREARS query only;
-- ported here to the dues query, same shape.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. M3: issue_budget — the budget, its lines and its dues, atomically.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS issue_budget(JSONB, JSONB, JSONB);
CREATE FUNCTION issue_budget(p_budget JSONB, p_lines JSONB, p_dues JSONB)
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
  -- 0093-style scope guard: every dues row must land inside the budget's
  -- own scope, or a crafted payload could bill another building's units.
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

  -- budget_id and created_by are stamped HERE, whatever the payload says —
  -- the client cannot attach dues to someone else's budget.
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
REVOKE ALL ON FUNCTION issue_budget(JSONB, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION issue_budget(JSONB, JSONB, JSONB) TO authenticated;

-- ------------------------------------------------------------
-- 2. M4: dues are private to their party, 0097 pattern.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS dues_select ON dues;
CREATE POLICY dues_select ON dues FOR SELECT USING (
  user_can(building_id, 'finance.view')
  OR user_owns_unit(unit_id)
  OR (user_tenants_unit(unit_id)
      AND billed_to = 'tenant'
      AND (tenant_id = auth.uid() OR tenant_id IS NULL))
);

-- ------------------------------------------------------------
-- 3. L1: a dues reminder candidate with nobody to notify is not a
--    candidate — it must not burn the day's dedup slot (0088 pattern).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_overdue_dues()
RETURNS TABLE (
  unit_id        UUID,
  unit_label     TEXT,
  building_id    UUID,
  building_name  TEXT,
  period_label   TEXT,
  due_date       DATE,
  amount_due     NUMERIC,
  party          TEXT,
  tenant_id      UUID,
  tenant_name    TEXT,
  is_overdue     BOOLEAN,
  owner_user_ids UUID[]
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Beirut')::date AS d),
  live AS (
    SELECT d.*, t.d AS today,
           effective_obligation_party(d.unit_id, d.billed_to, d.tenant_id) AS eff_party
    FROM dues d
    CROSS JOIN today t
    JOIN buildings b ON b.id = d.building_id AND b.is_active = true
    WHERE d.due_date IS NOT NULL
      AND effective_billing_mode(d.building_id) = 'dues'
      AND d.amount_due > 0
      AND reminder_is_send_day(t.d, d.created_at::date, d.due_date)
  ),
  agg AS (
    SELECT
      l.unit_id, l.building_id, l.eff_party, l.tenant_id, l.today,
      MIN(l.due_date)                       AS due_date,
      MIN(l.created_at)                     AS since,
      SUM(l.amount_due)                     AS billed,
      COUNT(*)                              AS periods,
      (ARRAY_AGG(l.period_label ORDER BY l.due_date))[1] AS period_label
    FROM live l
    GROUP BY l.unit_id, l.building_id, l.eff_party, l.tenant_id, l.today
  ),
  settled AS (
    SELECT a.*,
      (SELECT COALESCE(SUM(p.amount_usd), 0) FROM payments p
        WHERE p.unit_id = a.unit_id AND p.voided_at IS NULL
          AND p.created_at >= a.since
          AND CASE WHEN a.eff_party = 'tenant'
                   THEN p.paid_by = 'tenant' AND (a.tenant_id IS NULL OR p.tenant_id = a.tenant_id)
                   ELSE p.paid_by IS DISTINCT FROM 'tenant' END) AS paid
    FROM agg a
  )
  SELECT
    s.unit_id, u.label, b.id, b.name,
    CASE WHEN s.periods > 1 THEN s.period_label || ' +' || (s.periods - 1) ELSE s.period_label END,
    s.due_date,
    GREATEST(0, ROUND(s.billed - s.paid, 2)),
    s.eff_party, s.tenant_id,
    (SELECT pr.full_name FROM profiles pr WHERE pr.id = s.tenant_id),
    (s.today > s.due_date) AS is_overdue,
    recips.ids
  FROM settled s
  JOIN units u     ON u.id = s.unit_id
  JOIN buildings b ON b.id = s.building_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(ARRAY_AGG(DISTINCT m.user_id), ARRAY[]::UUID[]) AS ids
    FROM memberships m
    WHERE m.unit_id = s.unit_id AND m.ended_at IS NULL
      AND ((s.eff_party = 'tenant' AND m.tenure = 'tenant'
              AND (s.tenant_id IS NULL OR m.user_id = s.tenant_id))
        OR (s.eff_party = 'owner'  AND m.tenure = 'owner'))
  ) recips
  WHERE GREATEST(0, ROUND(s.billed - s.paid, 2)) > 0
    AND cardinality(recips.ids) > 0        -- nobody to notify → not a candidate
    AND NOT EXISTS (
      SELECT 1 FROM reminders_sent rs
      WHERE rs.unit_id = s.unit_id AND rs.sent_on = s.today
        AND rs.party = s.eff_party AND rs.source = 'dues'
    );
$$;
REVOKE ALL     ON FUNCTION get_overdue_dues() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_overdue_dues() TO service_role;

COMMIT;

-- Post-run checks:
--   M3: Issue a budget from the Dues page → one budget, its lines, its dues,
--       all present; kill the connection mid-issue → nothing at all.
--       Add an extraordinary expense in a dues-mode building → same.
--       As a non-manager: select issue_budget(...) → 'Not allowed'.
--   M4: As a resident: SELECT * FROM dues → only their own units' rows
--       (tenant: only tenant-billed ones). As finance.view: everything.
--   L1: A dues unit whose owner membership ended → no row from
--       get_overdue_dues, and no reminders_sent burn for it that day.
