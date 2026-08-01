-- ============================================================
-- 0064_owner_tenant_ledger.sql
-- Split a leased unit's money into an OWNER ledger and a TENANT ledger (T5–T9).
--
-- Attribution per money row:
--   charges.billed_to   already exists ('owner'|'tenant'|'both'); legacy 'both'
--                        counts as OWNER in the split (owner is ultimately liable)
--   payments.paid_by    NEW — who paid (owner|tenant); existing rows → owner
--   adjustments.party   NEW — whose ledger (owner|tenant); existing rows → owner
--   units.opening_balance → always the OWNER's (they owned it before)
--
-- owner balance  = opening + owner payments  − owner charges  + owner adjustments
-- tenant balance =          tenant payments − tenant charges + tenant adjustments
-- total          = owner + tenant  (unchanged from before, so nothing else moves)
--
-- unit_balance() / unit_balance_asof() still return the TOTAL, so guards,
-- dashboard and reports keep working. Per-party numbers are derived where needed.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE payments    ADD COLUMN IF NOT EXISTS paid_by TEXT NOT NULL DEFAULT 'owner'
                        CHECK (paid_by IN ('owner','tenant'));
ALTER TABLE adjustments ADD COLUMN IF NOT EXISTS party   TEXT NOT NULL DEFAULT 'owner'
                        CHECK (party   IN ('owner','tenant'));

COMMENT ON COLUMN payments.paid_by IS 'Owner/tenant sub-ledger this payment belongs to (0064).';
COMMENT ON COLUMN adjustments.party IS 'Owner/tenant sub-ledger this adjustment belongs to (0064).';

-- Party-aware balance, for anywhere the split is needed server-side (dues true-up,
-- reports). p_party NULL = total (identical to unit_balance).
CREATE OR REPLACE FUNCTION unit_party_balance(p_unit UUID, p_party TEXT)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT ROUND(
      -- opening belongs to the owner
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
$$;

GRANT EXECUTE ON FUNCTION unit_party_balance(UUID, TEXT) TO authenticated;

COMMIT;

-- Post-run check: owner + tenant must equal the total for every unit.
--   SELECT id, label,
--          unit_party_balance(id,'owner')  AS owner,
--          unit_party_balance(id,'tenant') AS tenant,
--          unit_party_balance(id, NULL)    AS total,
--          unit_balance(id)                AS total_check
--   FROM units LIMIT 20;
