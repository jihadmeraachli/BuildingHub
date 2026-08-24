-- ============================================================
-- 0121_repost_expense.sql
-- Finance audit finding H4: editing an expense rewrote history.
--
-- Editing a regular (non-metered) expense was update → delete charges →
-- insert charges as three unchecked client calls. Four real defects:
--   a) the party was RE-STAMPED from today's tenancy state — a charge
--      billed to a former tenant silently re-billed the current tenant
--      or the owner on a plain typo fix.
--   b) the blind DELETE destroyed any VOIDED charge on the expense —
--      the audit trail of a correction that already happened.
--   c) the charges-Insert trigger and Database Webhook re-fired, so every
--      resident got a duplicate "new charge" email for a description edit.
--   d) a failure between the delete and the insert left the book missing
--      charges the expense still claims — the exact class 0092 fixed for
--      metered expenses (repost_metered_expense), never extended here.
--
-- This mirrors 0092's repost_metered_expense shape exactly, for a REGULAR
-- expense: one SECURITY DEFINER function, one transaction.
--   a) fixed: every unit that already had a live charge on this expense
--      keeps ITS billed_to/tenant_id, unconditionally. Only a unit newly
--      added to the split (no prior charge) uses p_default_leased_to.
--   b) fixed: only non-voided charges are replaced; voided ones untouched.
--   c) fixed: new column charges.notify_suppressed — the reposted rows set
--      it TRUE, and notify_on_charge() (0009/0067) now skips them. The
--      dynamic-action edge function needs the matching change (below) and
--      a REDEPLOY — same requirement as every webhook-touching change.
--   d) fixed: one function, one transaction.
--
-- The client keeps computing the allocation amounts (allocate(), by_shares/
-- by_units/custom) exactly as before — re-implementing that in SQL is not
-- worth the risk tonight. What moves into the database is the part that was
-- actually unsafe: committing the update+delete+insert as one unit, with the
-- party-preserving and notification rules the client could not enforce.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. The suppression flag (c).
-- ------------------------------------------------------------
ALTER TABLE charges ADD COLUMN IF NOT EXISTS notify_suppressed BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN charges.notify_suppressed IS
  'TRUE on a charge written by repost_expense()/repost_metered_expense() — a re-post of an existing expense, not a new charge. notify_on_charge() and the dynamic-action charges-Insert webhook both skip these (redeploy dynamic-action after this migration).';

CREATE OR REPLACE FUNCTION notify_on_charge() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.notify_suppressed THEN RETURN NEW; END IF;
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT m.user_id, NEW.building_id, 'charge_issued',
         'New charge', COALESCE(NEW.description, 'Charge') || ' — $' || NEW.amount_usd
  FROM memberships m
  WHERE m.unit_id = NEW.unit_id AND m.ended_at IS NULL
    AND (
      (NEW.billed_to = 'tenant' AND m.tenure = 'tenant'
         AND (NEW.tenant_id IS NULL OR m.user_id = NEW.tenant_id))
      OR (NEW.billed_to <> 'tenant' AND m.tenure = 'owner')
    );
  RETURN NEW;
END; $$;

-- ------------------------------------------------------------
-- 2. repost_expense: update the expense + rebuild its LIVE charges,
--    preserving party stamps and voided rows, in one transaction.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS repost_expense(UUID, JSONB, JSONB, TEXT);
CREATE FUNCTION repost_expense(
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

  -- Snapshot the LIVE party stamps before touching anything (a).
  CREATE TEMP TABLE IF NOT EXISTS _prior_party ON COMMIT DROP AS
    SELECT unit_id, billed_to, tenant_id FROM charges
    WHERE expense_id = p_expense AND voided_at IS NULL;

  -- Replace only the LIVE charges — a voided one is a correction that
  -- already happened, and stays exactly as it was (b).
  DELETE FROM charges WHERE expense_id = p_expense AND voided_at IS NULL;

  WITH resolved AS (
    SELECT
      (r->>'unit_id')::UUID AS unit_id,
      (r->>'building_id')::UUID AS building_id,
      (r->>'amount_usd')::NUMERIC AS amount_usd,
      COALESCE(pp.billed_to,
               CASE WHEN p_default_leased_to = 'tenant' AND EXISTS (
                      SELECT 1 FROM memberships m WHERE m.unit_id = (r->>'unit_id')::UUID
                        AND m.tenure = 'tenant' AND m.ended_at IS NULL)
                    THEN 'tenant' ELSE 'owner' END) AS billed_to,
      pp.tenant_id AS prior_tenant_id
    FROM jsonb_array_elements(p_rows) AS r
    LEFT JOIN _prior_party pp ON pp.unit_id = (r->>'unit_id')::UUID
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
    TRUE  -- a re-post, not a first issuance (c)
  FROM resolved;
END;
$$;
GRANT EXECUTE ON FUNCTION repost_expense(UUID, JSONB, JSONB, TEXT) TO authenticated;

COMMIT;

-- Post-run checks:
--   Edit an expense's description only (no unit/amount change) → charges
--     unchanged in party, no duplicate "new charge" email/notification.
--   Void one of an expense's charges, then edit the expense (e.g. fix a
--     typo) → the voided charge is still voided and still there afterward.
--   Edit an expense whose tenant has since moved out → the charge stays
--     billed to that ORIGINAL tenant, not silently reassigned to the owner
--     or a new tenant.
--   Add a unit to the split that had no prior charge → billed per the
--     chosen party (p_default_leased_to), same as a brand-new expense would.
--   Try repost_expense on a metered expense → 'edit the cycle' error.
-- ⚠️ Redeploy dynamic-action after this migration (charges-Insert handler
--    must also skip notify_suppressed rows — see its updated source).
