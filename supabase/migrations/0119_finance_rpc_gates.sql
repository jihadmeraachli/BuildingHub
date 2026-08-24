-- ============================================================
-- 0119_finance_rpc_gates.sql
-- Finance audit findings C1 (proper fix) + H1.
--
-- C1 (proper fix — last night's hotfix was a REVOKE-only perimeter fence).
-- can_view_unit_finance()/building_book_asof()/user_outstanding() treated a
-- NULL auth.uid() as "let it through" — meant as a service-role bypass, but
-- an anonymous PostgREST caller also has a null uid. Same class 0111 fixed
-- for the cron functions; rewritten here to the same auth.role() =
-- 'service_role' pattern. This migration is idempotent and self-contained —
-- it re-applies the REVOKE even if last night's ad-hoc hotfix already ran.
--
-- H1. unit_party_balance / unit_party_balance_asof / party_payments_after /
-- request_line_outstanding are SECURITY DEFINER, granted to authenticated,
-- and had NO caller check at all — the 0043 lockdown discipline was written
-- for unit_balance() and never extended to these later twins. Any signed-in
-- user of any tenant could read another building's owner/tenant balances by
-- guessing or enumerating a unit/request-line uuid. Gated now with the same
-- can_view_unit_finance() rule as unit_balance(); converted from LANGUAGE sql
-- to plpgsql (a plain SQL function can't RAISE on its own).
--
-- Checked every internal caller before writing this (offload triggers 0065/
-- 0066, request_payment 0076-0088, get_overdue_units 0076-0088): every path
-- that reaches these functions already required 'charge.manage' or
-- 'resident.manage', and both bundles always carry 'finance.view' in the
-- same role (permissions.ts) — so the new gate cannot break any existing
-- call. get_overdue_units() runs as service role, which the gate admits.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. C1: the real fix — service role, not "nobody logged in".
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION can_view_unit_finance(p_unit UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT (auth.role() = 'service_role' OR current_user = 'service_role')
      OR is_platform_admin()
      OR user_can((SELECT building_id FROM units WHERE id = p_unit), 'finance.view')
      OR EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.unit_id = p_unit AND m.user_id = auth.uid() AND m.ended_at IS NULL
        );
$$;

CREATE OR REPLACE FUNCTION building_book_asof(p_building UUID, p_asof DATE)
RETURNS TABLE(unit_id UUID, label TEXT, balance NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF NOT (
    (auth.role() = 'service_role' OR current_user = 'service_role')
    OR is_platform_admin()
    OR user_can(p_building, 'finance.view')
  ) THEN
    RAISE EXCEPTION 'Not authorized for this building''s finances.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT u.id, u.label, unit_balance_asof(u.id, p_asof)
    FROM units u
    WHERE u.building_id = p_building
    ORDER BY u.label;
END;
$$;

CREATE OR REPLACE FUNCTION user_outstanding(p_user UUID)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF NOT (
    (auth.role() = 'service_role' OR current_user = 'service_role')
    OR auth.uid() = p_user
    OR is_platform_admin()
    OR EXISTS (
          SELECT 1 FROM memberships m
          JOIN units u ON u.id = m.unit_id
          WHERE m.user_id = p_user AND m.ended_at IS NULL
            AND user_can(u.building_id, 'finance.view')
        )
  ) THEN
    RAISE EXCEPTION 'Not authorized for this user''s finances.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT SUM(unit_balance(m.unit_id))
    FROM memberships m
    WHERE m.user_id = p_user AND m.ended_at IS NULL
  ), 0);
END;
$$;

-- ------------------------------------------------------------
-- 2. H1: gate the party-balance family the same way.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION unit_party_balance(p_unit UUID, p_party TEXT)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF NOT can_view_unit_finance(p_unit) THEN
    RAISE EXCEPTION 'Not authorized for this unit''s finances.' USING ERRCODE = '42501';
  END IF;
  RETURN ROUND(
      CASE WHEN p_party IS NULL OR p_party = 'owner'
           THEN COALESCE((SELECT opening_balance FROM units WHERE id = p_unit), 0) ELSE 0 END
    + COALESCE((SELECT SUM(amount_usd) FROM payments
                 WHERE unit_id = p_unit AND voided_at IS NULL
                   AND (p_party IS NULL OR paid_by = p_party)), 0)
    - COALESCE((SELECT SUM(amount_usd) FROM charges
                 WHERE unit_id = p_unit AND voided_at IS NULL
                   AND (p_party IS NULL
                        OR (p_party = 'owner'  AND billed_to IN ('owner','both'))
                        OR (p_party = 'tenant' AND billed_to = 'tenant'))), 0)
    + COALESCE((SELECT SUM(adjustment_effect(kind, amount_usd)) FROM adjustments
                 WHERE unit_id = p_unit AND voided_at IS NULL
                   AND (p_party IS NULL OR party = p_party)), 0)
  , 2);
END;
$$;

CREATE OR REPLACE FUNCTION unit_party_balance_asof(p_unit UUID, p_party TEXT, p_asof DATE)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF NOT can_view_unit_finance(p_unit) THEN
    RAISE EXCEPTION 'Not authorized for this unit''s finances.' USING ERRCODE = '42501';
  END IF;
  RETURN ROUND(
      CASE WHEN p_party IS NULL OR p_party = 'owner'
           THEN COALESCE((SELECT opening_balance FROM units WHERE id = p_unit
                            AND (opening_balance_date IS NULL OR opening_balance_date <= p_asof)), 0) ELSE 0 END
    + COALESCE((SELECT SUM(amount_usd) FROM payments
                 WHERE unit_id = p_unit AND voided_at IS NULL AND paid_on <= p_asof
                   AND (p_party IS NULL OR paid_by = p_party)), 0)
    - COALESCE((SELECT SUM(amount_usd) FROM charges
                 WHERE unit_id = p_unit AND voided_at IS NULL AND charge_date <= p_asof
                   AND (p_party IS NULL
                        OR (p_party = 'owner'  AND billed_to IN ('owner','both'))
                        OR (p_party = 'tenant' AND billed_to = 'tenant'))), 0)
    + COALESCE((SELECT SUM(adjustment_effect(kind, amount_usd)) FROM adjustments
                 WHERE unit_id = p_unit AND voided_at IS NULL AND effective_date <= p_asof
                   AND (p_party IS NULL OR party = p_party)), 0)
  , 2);
END;
$$;

CREATE OR REPLACE FUNCTION party_payments_after(p_unit UUID, p_party TEXT, p_after DATE)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF NOT can_view_unit_finance(p_unit) THEN
    RAISE EXCEPTION 'Not authorized for this unit''s finances.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT SUM(amount_usd) FROM payments
    WHERE unit_id = p_unit AND voided_at IS NULL AND paid_on > p_after
      AND CASE WHEN p_party = 'tenant' THEN paid_by = 'tenant'
               ELSE paid_by IS DISTINCT FROM 'tenant' END
  ), 0);
END;
$$;

CREATE OR REPLACE FUNCTION request_line_outstanding(p_line UUID)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_line RECORD;
BEGIN
  SELECT l.unit_id, l.amount_requested, l.party, l.tenant_id, r.created_at AS request_created_at
    INTO v_line
    FROM payment_request_lines l JOIN payment_requests r ON r.id = l.request_id
   WHERE l.id = p_line;
  IF v_line IS NULL THEN RETURN 0; END IF;
  IF NOT can_view_unit_finance(v_line.unit_id) THEN
    RAISE EXCEPTION 'Not authorized for this unit''s finances.' USING ERRCODE = '42501';
  END IF;
  RETURN GREATEST(0, ROUND(v_line.amount_requested - COALESCE((
    SELECT SUM(p.amount_usd) FROM payments p
    WHERE p.unit_id = v_line.unit_id AND p.voided_at IS NULL
      AND p.created_at >= v_line.request_created_at
      AND CASE WHEN v_line.party = 'tenant'
               THEN p.paid_by = 'tenant' AND (v_line.tenant_id IS NULL OR p.tenant_id = v_line.tenant_id)
               ELSE p.paid_by IS DISTINCT FROM 'tenant' END
  ), 0), 2));
END;
$$;

-- ------------------------------------------------------------
-- 3. Close the anon/PUBLIC default-grant hole for every balance RPC —
--    self-contained even if last night's ad-hoc hotfix never ran here.
-- ------------------------------------------------------------
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN
      ('unit_balance','unit_balance_asof','building_book_asof','user_outstanding',
       'unit_party_balance','unit_party_balance_asof','party_payments_after',
       'request_line_outstanding')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.sig);
  END LOOP;
END $$;

COMMIT;

-- Post-run checks:
--   Anon (no login): any of the 8 functions above -> 401 permission denied.
--   Signed in as a resident, own unit: unit_balance/unit_party_balance -> a number.
--   Signed in as a resident, ANOTHER building's unit uuid: unit_party_balance
--     -> 'Not authorized for this unit''s finances.'
--   send-reminders (service role): still runs clean end to end.
--   Trigger a tenant offload (0065/0066) and issue a payment request as a
--     building admin: unaffected, still succeeds (internal callers verified
--     above always hold finance.view alongside the cap that reaches them).
