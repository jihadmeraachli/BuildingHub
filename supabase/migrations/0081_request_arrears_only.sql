-- ============================================================
-- 0081_request_arrears_only.sql
-- Payment requests are for ARREARS buildings only. Reverses 0080.
--
-- 0080 opened requests to dues buildings so a one-off large expense could be
-- collected. That reasoning no longer holds, for two reasons:
--
--   1. A prepay building sits in CREDIT most of the time, and request_payment
--      only bills units whose balance is NEGATIVE — so in dues mode it usually
--      finds nobody and sends nothing. Ahmad's case: dues 500 paid, 200 fuel
--      expensed, unit at +300, request sends nothing while the building needs
--      the cash.
--   2. Where it DOES find arrears, those arrears are already being collected by
--      the outstanding dues (a due prepays the expenses that put the ledger in
--      the red), so the request double-asks. request_payment bills the raw
--      ledger and knows nothing about outstanding dues.
--
-- Dues buildings now raise a one-off through Generate dues with the arrears
-- true-up switched OFF (6497e48) — a flat ask that collects in full even from a
-- unit in credit, which is exactly what the fuel case needed and what a
-- ledger-based request could never do.
--
-- Enforced in the RPC, not just the button: the client gate is UX.
-- Existing request lines are untouched and keep being chased — this only stops
-- NEW ones being raised in the wrong mode.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION request_payment(
  p_scope_type TEXT,
  p_scope_id   UUID,
  p_label      TEXT DEFAULT NULL,
  p_due_days   INT  DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ids UUID[];
  v_req UUID;
  v_days INT;
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
    RAISE EXCEPTION 'Not allowed to request payment here.' USING ERRCODE = '42501';
  END IF;

  -- Dues buildings collect a one-off through Generate dues with the true-up
  -- off. A ledger-based request would find nobody (they are prepaid) or
  -- double-ask arrears the outstanding dues already cover.
  IF EXISTS (SELECT 1 FROM unnest(v_ids) id WHERE effective_billing_mode(id) = 'dues') THEN
    RAISE EXCEPTION 'This building bills by dues. Raise a one-off with Generate dues and the arrears true-up switched off.'
      USING ERRCODE = 'P0001';
  END IF;

  v_days := COALESCE(p_due_days, effective_due_days(v_ids[1]));

  -- Supersede whatever is still open in this scope (0079): two live requests
  -- for the same balance bill the resident twice.
  UPDATE payment_request_lines l
     SET cancelled_at = now()
   WHERE l.cancelled_at IS NULL
     AND l.building_id = ANY(v_ids);

  INSERT INTO payment_requests (building_id, compound_id, label, due_date, created_by)
  VALUES (
    CASE WHEN p_scope_type = 'building' THEN p_scope_id END,
    CASE WHEN p_scope_type = 'compound' THEN p_scope_id END,
    NULLIF(btrim(COALESCE(p_label, '')), ''),
    CURRENT_DATE + v_days,
    auth.uid())
  RETURNING id INTO v_req;

  INSERT INTO payment_request_lines (request_id, unit_id, building_id, party, tenant_id, amount_requested)
  SELECT v_req, u.id, u.building_id, pb.party,
         CASE WHEN pb.party = 'tenant' THEN (
           SELECT m.user_id FROM memberships m
           WHERE m.unit_id = u.id AND m.tenure = 'tenant' AND m.ended_at IS NULL
           ORDER BY m.created_at DESC LIMIT 1) END,
         pb.owed
  FROM units u
  CROSS JOIN LATERAL (
    -- unit_party_balance(unit, party) is signed: negative = owes (0064)
    SELECT 'owner'::TEXT AS party, ROUND(-unit_party_balance(u.id, 'owner'), 2) AS owed
    UNION ALL
    SELECT 'tenant',               ROUND(-unit_party_balance(u.id, 'tenant'), 2)
  ) pb
  WHERE u.building_id = ANY(v_ids) AND pb.owed > 0;

  RETURN v_req;
END;
$$;

GRANT EXECUTE ON FUNCTION request_payment(TEXT, UUID, TEXT, INT) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   SELECT request_payment('building','<a DUES building>');
--     -> raises "This building bills by dues..."
--   SELECT request_payment('building','<an ARREARS building>');
--     -> still works, still supersedes any open request
--   Existing request lines in a dues building keep being reminded; only NEW
--   ones are blocked.
-- ============================================================
