-- ============================================================
-- 0143_billing_mode_transition.sql
-- Transition audit MT1/MT2/MT3/MT4/MT5: the mode flip was a bare column UPDATE
-- with no reconciliation, stranding money in both directions:
--   dues→arrears  → open dues silently FORGIVEN (never on the ledger, dropped
--                   from get_overdue_dues by the mode filter).
--   arrears→dues  → stale payment_request_lines keep DOUBLE-CHASING.
--
-- FIX: route the flip through set_billing_mode(), a SECURITY DEFINER RPC that
-- reconciles the outgoing obligations atomically, then sets the mode:
--   · → arrears: post each open due's amount_due as a ledger CHARGE (the
--       existing on-ledger payments net against it, so the residual is exactly
--       what's still owed), and mark the due converted so it isn't re-shown or
--       re-chased. notify_suppressed = TRUE (housekeeping, not resident news).
--   · → dues:    cancel open payment_request_lines for the affected blocks
--       (the carry-fold rolls the arrears balance into the first dues period).
-- The client calls this instead of updating billing_mode directly (see the
-- Buildings/Compounds save handlers).
--
-- ⚠️ MONEY-CRITICAL and not exercised on live dues data (demo is arrears-only) —
--    test the →arrears conversion on a real dues building before relying on it.
--
-- Additive & idempotent (converted_at guards re-conversion).
-- ============================================================
BEGIN;

-- 1. Mark a due that was converted to a ledger charge on a flip to arrears.
ALTER TABLE dues ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;
COMMENT ON COLUMN dues.converted_at IS
  'Set when the dues obligation was posted to the ledger as a charge during a dues→arrears mode flip (0143). Such rows are excluded from the Dues tab and never re-converted.';

-- 2. The validated, reconciling flip.
CREATE OR REPLACE FUNCTION set_billing_mode(p_kind TEXT, p_id UUID, p_mode TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_buildings UUID[];
  v_old TEXT;
  v_conv INT := 0; v_amt NUMERIC := 0; v_cancelled INT := 0;
BEGIN
  IF p_kind NOT IN ('building','compound') THEN RAISE EXCEPTION 'Bad scope kind.' USING ERRCODE = '22023'; END IF;
  IF p_mode NOT IN ('arrears','dues')      THEN RAISE EXCEPTION 'Bad billing mode.' USING ERRCODE = '22023'; END IF;

  -- Authorize like the table RLS: building manager, or compound manager.
  IF NOT (is_platform_admin()
          OR (p_kind = 'building' AND user_can(p_id, 'building.manage'))
          OR (p_kind = 'compound' AND user_manages_compound(p_id))) THEN
    RAISE EXCEPTION 'Not allowed to change billing mode here.' USING ERRCODE = '42501';
  END IF;

  IF p_kind = 'building' THEN
    v_old := effective_billing_mode(p_id);
    v_buildings := ARRAY[p_id];
  ELSE
    SELECT billing_mode INTO v_old FROM compounds WHERE id = p_id;
    SELECT COALESCE(ARRAY_AGG(id), ARRAY[]::UUID[]) INTO v_buildings FROM buildings WHERE compound_id = p_id;
  END IF;

  IF v_old IS DISTINCT FROM p_mode THEN
    IF p_mode = 'arrears' THEN
      -- dues → arrears: convert every open (unpaid, unconverted) due to a charge.
      SELECT COALESCE(SUM(amount_due), 0), COUNT(*) INTO v_amt, v_conv
        FROM dues WHERE building_id = ANY(v_buildings) AND amount_due > 0 AND converted_at IS NULL;
      INSERT INTO charges (expense_id, unit_id, building_id, category, description, amount_usd,
                           charge_date, billed_to, tenant_id, created_by, notify_suppressed)
      SELECT NULL, d.unit_id, d.building_id, 'common_expenses',
             'Dues carryover: ' || COALESCE(d.period_label, ''), d.amount_due,
             CURRENT_DATE, d.billed_to, d.tenant_id, auth.uid(), TRUE
      FROM dues d
      WHERE d.building_id = ANY(v_buildings) AND d.amount_due > 0 AND d.converted_at IS NULL;
      UPDATE dues SET converted_at = now()
       WHERE building_id = ANY(v_buildings) AND amount_due > 0 AND converted_at IS NULL;
    ELSE
      -- arrears → dues: cancel stale open payment requests so the arrears cron
      -- goes quiet; the carry-fold handles the balance in the first dues period.
      UPDATE payment_request_lines SET cancelled_at = now()
       WHERE building_id = ANY(v_buildings) AND cancelled_at IS NULL;
      GET DIAGNOSTICS v_cancelled = ROW_COUNT;
    END IF;
  END IF;

  -- Finally flip the mode.
  IF p_kind = 'building' THEN
    UPDATE buildings SET billing_mode = p_mode WHERE id = p_id;
  ELSE
    UPDATE compounds SET billing_mode = p_mode WHERE id = p_id;
  END IF;

  RETURN jsonb_build_object('from', v_old, 'to', p_mode,
    'converted_dues', v_conv, 'converted_amount', v_amt, 'cancelled_requests', v_cancelled);
END;
$$;
REVOKE ALL ON FUNCTION set_billing_mode(TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_billing_mode(TEXT, UUID, TEXT) TO authenticated;

COMMIT;

-- Post-run checks:
--   dues→arrears on a building with 3 open dues ($300) → returns
--     {converted_dues:3, converted_amount:300, ...}; 3 charges appear (suppressed),
--     the dues get converted_at set, unit balance now shows the real residual.
--   arrears→dues with 2 open request lines → {cancelled_requests:2}; arrears
--     cron stops (also enforced by 0142), dues carry-fold covers the balance.
--   No mode change (same mode) → zero counts, just idempotent.
