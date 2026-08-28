-- ============================================================
-- 0158_special_charges.sql
-- Special charges become first-class (Jey's QA, 2026-08-29), and asks
-- learn to NET.
--
-- WHAT THE QA FOUND.
--   1. The chained payment request asked each unit's FULL balance, dragging
--      old arrears into a 48-hour emergency ask.
--   2. The special charge existed only as anonymous charge rows - nothing to
--      list, void, or point at.
--   3. The extraordinary-expense request (0089/0091) asked its flat slice
--      even from units sitting on credit.
--
-- THE ONE RULE THAT FIXES 1 AND 3 - the netted ask:
--
--     ask = LEAST(the slice of THIS charge, the party's outstanding balance)
--
--   A unit that owes $500 and is charged $100 is asked exactly $100 (old
--   arrears stay with the general request cycle). A unit holding $150 credit
--   charged $100 is asked $0 (credit absorbs it). A unit holding $40 credit
--   charged $100 is asked $60. Reminders then chase the request line as
--   usual: frozen ask minus payments since (0088).
--
-- WHAT THIS ADDS.
--   special_charges            one row per issued special charge (the entity:
--                              label, total, method, party, voided_at)
--   charges.special_charge_id  its charges point back at it
--   payment_requests.special_charge_id
--   create_special_charge()    the sealed door: inserts the charges (deriving
--                              building/tenant SERVER-side - 0128 discipline,
--                              client amounts only) and optionally issues the
--                              netted request in the same transaction
--   void_special_charge()      voids its charges + cancels its request lines
--   request_payment_for_expense() restated from 0091 + the netted ask + a
--                              voided-charges filter
--
-- Additive & idempotent.
-- ============================================================
BEGIN;
SET LOCAL lock_timeout = '10s';

-- ------------------------------------------------------------
-- 1. The entity.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS special_charges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id  UUID REFERENCES buildings(id) ON DELETE CASCADE,
  compound_id  UUID REFERENCES compounds(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  total_usd    NUMERIC(12,2) NOT NULL CHECK (total_usd > 0),
  method       TEXT NOT NULL DEFAULT 'by_shares' CHECK (method IN ('by_shares', 'equal')),
  billed_to    TEXT NOT NULL DEFAULT 'owner' CHECK (billed_to IN ('owner', 'tenant')),
  created_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at    TIMESTAMPTZ,
  voided_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT special_charges_scope CHECK ((building_id IS NOT NULL) <> (compound_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS special_charges_building_idx ON special_charges(building_id, created_at DESC);
CREATE INDEX IF NOT EXISTS special_charges_compound_idx ON special_charges(compound_id, created_at DESC);

ALTER TABLE charges          ADD COLUMN IF NOT EXISTS special_charge_id UUID REFERENCES special_charges(id) ON DELETE SET NULL;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS special_charge_id UUID REFERENCES special_charges(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS charges_special_idx ON charges(special_charge_id) WHERE special_charge_id IS NOT NULL;

ALTER TABLE special_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS special_charges_select ON special_charges;
CREATE POLICY special_charges_select ON special_charges FOR SELECT USING (
  is_platform_admin()
  OR (building_id IS NOT NULL AND user_can(building_id, 'finance.view'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = special_charges.compound_id
          AND user_can(b.id, 'finance.view')))
);
-- no write policies: the RPCs below are the only doors

-- ------------------------------------------------------------
-- 2. The sealed door in. Client sends ONLY {unit_id, amount} rows - block,
--    party and tenant are derived server-side (0128 discipline).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_special_charge(
  p_scope_type TEXT,
  p_scope_id   UUID,
  p_label      TEXT,
  p_rows       JSONB,           -- [{unit_id, amount}]
  p_method     TEXT DEFAULT 'by_shares',
  p_billed_to  TEXT DEFAULT 'owner',
  p_request    BOOLEAN DEFAULT TRUE,
  p_due_days   INT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ids   UUID[];
  v_sc    UUID;
  v_req   UUID;
  v_total NUMERIC;
  v_days  INT;
BEGIN
  IF p_scope_type = 'building' THEN
    v_ids := ARRAY[p_scope_id];
  ELSIF p_scope_type = 'compound' THEN
    SELECT array_agg(id) INTO v_ids FROM buildings WHERE compound_id = p_scope_id;
  ELSE
    RAISE EXCEPTION 'Unknown scope %', p_scope_type USING ERRCODE = '22023';
  END IF;
  IF v_ids IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(v_ids) id
      WHERE is_platform_admin() OR user_can(id, 'charge.manage')) THEN
    RAISE EXCEPTION 'Not allowed to issue a special charge here.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ids) id WHERE effective_billing_mode(id) = 'dues') THEN
    RAISE EXCEPTION 'This scope bills prepaid. Use the special charge on the Prepaid page.'
      USING ERRCODE = 'P0001';
  END IF;
  IF btrim(COALESCE(p_label, '')) = '' THEN
    RAISE EXCEPTION 'The special charge needs a label.' USING ERRCODE = '22023';
  END IF;
  IF p_method NOT IN ('by_shares', 'equal') OR p_billed_to NOT IN ('owner', 'tenant') THEN
    RAISE EXCEPTION 'Invalid method or party.' USING ERRCODE = '22023';
  END IF;

  -- every named unit must exist, live, inside the scope; amounts positive
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) r
    LEFT JOIN units u ON u.id = (r->>'unit_id')::uuid AND u.deleted_at IS NULL
    WHERE u.id IS NULL OR NOT (u.building_id = ANY(v_ids)) OR COALESCE((r->>'amount')::numeric, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'A row names a unit outside this scope, or a non-positive amount.' USING ERRCODE = '22023';
  END IF;
  SELECT ROUND(SUM((r->>'amount')::numeric), 2) INTO v_total FROM jsonb_array_elements(p_rows) r;
  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'Nothing to charge.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO special_charges (building_id, compound_id, label, total_usd, method, billed_to, created_by)
  VALUES (
    CASE WHEN p_scope_type = 'building' THEN p_scope_id END,
    CASE WHEN p_scope_type = 'compound' THEN p_scope_id END,
    btrim(p_label), v_total, p_method, p_billed_to, auth.uid())
  RETURNING id INTO v_sc;

  -- the charges: block from the unit, party/tenant derived here. 'tenant'
  -- falls back to the owner on units with no live tenant (T5 rule).
  INSERT INTO charges (special_charge_id, unit_id, building_id, category, description,
                       amount_usd, charge_date, billed_to, tenant_id, created_by)
  SELECT v_sc, u.id, u.building_id, 'other', btrim(p_label),
         ROUND((r->>'amount')::numeric, 2), CURRENT_DATE,
         CASE WHEN p_billed_to = 'tenant' AND tn.user_id IS NOT NULL THEN 'tenant' ELSE 'owner' END,
         CASE WHEN p_billed_to = 'tenant' THEN tn.user_id END,
         auth.uid()
  FROM jsonb_array_elements(p_rows) r
  JOIN units u ON u.id = (r->>'unit_id')::uuid
  LEFT JOIN LATERAL (
    SELECT m.user_id FROM memberships m
    WHERE m.unit_id = u.id AND m.tenure = 'tenant' AND m.ended_at IS NULL
    ORDER BY m.created_at DESC LIMIT 1
  ) tn ON TRUE;

  -- the netted request: only THIS charge, only where the balance still owes
  IF p_request THEN
    v_days := COALESCE(p_due_days, effective_due_days(v_ids[1]));
    -- one live request per scope (0079)
    UPDATE payment_request_lines l SET cancelled_at = now()
     WHERE l.cancelled_at IS NULL AND l.building_id = ANY(v_ids);

    INSERT INTO payment_requests (building_id, compound_id, label, due_date, special_charge_id, created_by)
    VALUES (
      CASE WHEN p_scope_type = 'building' THEN p_scope_id END,
      CASE WHEN p_scope_type = 'compound' THEN p_scope_id END,
      btrim(p_label), CURRENT_DATE + v_days, v_sc, auth.uid())
    RETURNING id INTO v_req;

    INSERT INTO payment_request_lines (request_id, unit_id, building_id, party, tenant_id, amount_requested)
    SELECT v_req, c.unit_id, c.building_id,
           CASE WHEN c.billed_to = 'tenant' THEN 'tenant' ELSE 'owner' END,
           CASE WHEN c.billed_to = 'tenant' THEN c.tenant_id END,
           ask.v
    FROM charges c
    CROSS JOIN LATERAL (
      -- the netted ask: the slice, capped by what the party actually owes
      -- NOW (the balance already includes this charge)
      SELECT LEAST(c.amount_usd, GREATEST(0,
        -unit_party_balance(c.unit_id, CASE WHEN c.billed_to = 'tenant' THEN 'tenant' ELSE 'owner' END)
      )) AS v
    ) ask
    WHERE c.special_charge_id = v_sc AND ask.v > 0.005;
  END IF;

  RETURN v_sc;
END;
$$;
GRANT EXECUTE ON FUNCTION create_special_charge(TEXT, UUID, TEXT, JSONB, TEXT, TEXT, BOOLEAN, INT) TO authenticated;

-- ------------------------------------------------------------
-- 3. The door out: void the whole thing in one shot.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION void_special_charge(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sc special_charges;
BEGIN
  SELECT * INTO v_sc FROM special_charges WHERE id = p_id FOR UPDATE;
  IF v_sc.id IS NULL THEN RAISE EXCEPTION 'Special charge not found.' USING ERRCODE = '22023'; END IF;
  IF NOT (is_platform_admin()
    OR (v_sc.building_id IS NOT NULL AND user_can(v_sc.building_id, 'charge.manage'))
    OR (v_sc.compound_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM buildings b WHERE b.compound_id = v_sc.compound_id
            AND user_can(b.id, 'charge.manage')))) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  IF v_sc.voided_at IS NOT NULL THEN RETURN; END IF;

  UPDATE charges SET voided_at = now(), voided_by = auth.uid(), void_reason = 'Special charge voided'
   WHERE special_charge_id = p_id AND voided_at IS NULL;
  UPDATE payment_request_lines l SET cancelled_at = now()
    FROM payment_requests r
   WHERE r.id = l.request_id AND r.special_charge_id = p_id AND l.cancelled_at IS NULL;
  UPDATE special_charges SET voided_at = now(), voided_by = auth.uid() WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION void_special_charge(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 4. The extraordinary-expense ask learns the same netting (0091 verbatim +
--    the LEAST clamp + skip voided charges + skip zero asks).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_payment_for_expense(p_expense UUID, p_due_days INT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_exp   RECORD;
  v_ids   UUID[];
  v_req   UUID;
  v_days  INT;
BEGIN
  SELECT e.* INTO v_exp FROM expenses e WHERE e.id = p_expense;
  IF v_exp IS NULL THEN
    RAISE EXCEPTION 'Expense not found.' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT c.building_id) INTO v_ids FROM charges c WHERE c.expense_id = p_expense;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'This expense has no charges to collect.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM unnest(v_ids) id
                  WHERE is_platform_admin() OR user_can(id, 'charge.manage')) THEN
    RAISE EXCEPTION 'Not allowed to request payment here.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(v_ids) id WHERE effective_billing_mode(id) = 'dues') THEN
    RAISE EXCEPTION 'This building bills by dues. The extraordinary ask is issued as a flat budget instead.'
      USING ERRCODE = 'P0001';
  END IF;

  v_days := COALESCE(p_due_days, effective_due_days(v_ids[1]));

  INSERT INTO payment_requests (building_id, compound_id, label, due_date, expense_id, created_by)
  VALUES (v_exp.building_id, v_exp.compound_id,
          'Extraordinary: ' || v_exp.description,
          CURRENT_DATE + v_days, p_expense, auth.uid())
  RETURNING id INTO v_req;

  INSERT INTO payment_request_lines (request_id, unit_id, building_id, party, tenant_id, amount_requested)
  SELECT v_req, c.unit_id, c.building_id,
         CASE WHEN c.billed_to = 'tenant' THEN 'tenant' ELSE 'owner' END,
         CASE WHEN c.billed_to = 'tenant' THEN c.tenant_id END,
         ask.v
  FROM charges c
  CROSS JOIN LATERAL (
    -- 0158: the netted ask - a unit in credit is not asked (QA: it was)
    SELECT LEAST(c.amount_usd, GREATEST(0,
      -unit_party_balance(c.unit_id, CASE WHEN c.billed_to = 'tenant' THEN 'tenant' ELSE 'owner' END)
    )) AS v
  ) ask
  WHERE c.expense_id = p_expense AND c.voided_at IS NULL AND ask.v > 0.005;

  RETURN v_req;
END;
$$;
GRANT EXECUTE ON FUNCTION request_payment_for_expense(UUID, INT) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks (SQL Editor / app):
--   1. Issue a special charge $100 by shares with request, 2 days:
--      - a unit owing $500 → line asks exactly its slice, not $600
--      - a unit holding credit > its slice → NO line (not chased)
--      - a unit with credit $40 vs slice $100 → line asks $60
--   2. The Finance > Expenses tab lists it; Void removes the charges from
--      every balance and stops the chasing in one click.
--   3. Extraordinary expense request: unit in credit no longer asked.
--   4. As a resident: SELECT * FROM special_charges → only their scope's rows.
-- ============================================================
