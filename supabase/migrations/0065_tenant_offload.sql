-- ============================================================
-- 0065_tenant_offload.sql
-- T10: when a tenant moves out, their leftover balance is AUTOMATICALLY
-- transferred to the owner — and ALL history is preserved (this is exactly the
-- data you need when there's an owner↔tenant dispute).
--
-- Mechanism: two paired "transfer" adjustments dated the move-out day —
--   · one that zeroes the tenant sub-ledger
--   · one that moves the same amount onto the owner
-- so the unit TOTAL is unchanged, the tenant's original charges/payments stay,
-- and the owner sees a labelled line with the FORMER TENANT'S NAME.
--
-- New:
--   · adjustment kinds 'transfer_in' (+) / 'transfer_out' (−) — a signed transfer
--   · adjustments.counterparty_name — the other party's name, stored as text so
--     it survives even if that account is later deleted
--   · end_membership() now performs the offload and returns the transferred
--     amount (0 = nothing to move)
--
-- Additive & idempotent. Transactional.
-- ============================================================
BEGIN;

ALTER TABLE adjustments ADD COLUMN IF NOT EXISTS counterparty_name TEXT;

-- widen the kind check to include the transfer kinds
ALTER TABLE adjustments DROP CONSTRAINT IF EXISTS adjustments_kind_check;
ALTER TABLE adjustments ADD CONSTRAINT adjustments_kind_check CHECK (kind IN
  ('credit_note','discount','waiver','write_off','penalty','refund','transfer_in','transfer_out'));

CREATE OR REPLACE FUNCTION adjustment_effect(p_kind TEXT, p_amount NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_kind
    WHEN 'penalty'      THEN -p_amount
    WHEN 'refund'       THEN -p_amount
    WHEN 'transfer_out' THEN -p_amount
    ELSE p_amount   -- credit_note, discount, waiver, write_off, transfer_in
  END;
$$;

-- ------------------------------------------------------------
-- end_membership: soft-end + auto-offload a departing tenant's balance.
-- Returns the transferred amount (signed: what moved onto the owner).
-- Return type changes → drop then recreate.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS end_membership(UUID);
CREATE FUNCTION end_membership(p_membership UUID)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_unit UUID; v_building UUID; v_tenure TEXT; v_user UUID;
  v_bal NUMERIC := 0; v_name TEXT;
BEGIN
  SELECT m.unit_id, m.tenure, m.user_id, u.building_id
    INTO v_unit, v_tenure, v_user, v_building
    FROM memberships m JOIN units u ON u.id = m.unit_id
   WHERE m.id = p_membership;

  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'Membership not found.' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT user_can(v_building, 'resident.manage') THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;

  -- soft-end (the 0063 trigger blocks removing an owner while a tenant is active)
  UPDATE memberships SET ended_at = now() WHERE id = p_membership AND ended_at IS NULL;

  -- T10: a departing TENANT with a non-zero balance → transfer it to the owner
  IF v_tenure = 'tenant' THEN
    v_bal := unit_party_balance(v_unit, 'tenant');
    IF v_bal <> 0 THEN
      SELECT full_name INTO v_name FROM profiles WHERE id = v_user;

      -- zero the tenant sub-ledger: apply an effect of -v_bal
      INSERT INTO adjustments (unit_id, building_id, kind, amount_usd, party, effective_date, note, counterparty_name, created_by)
      VALUES (v_unit, v_building,
              CASE WHEN v_bal < 0 THEN 'transfer_in' ELSE 'transfer_out' END,
              abs(v_bal), 'tenant', CURRENT_DATE,
              'Moved out — balance transferred to owner', COALESCE(v_name, 'former tenant'), auth.uid());

      -- move the same amount onto the owner: apply an effect of +v_bal
      INSERT INTO adjustments (unit_id, building_id, kind, amount_usd, party, effective_date, note, counterparty_name, created_by)
      VALUES (v_unit, v_building,
              CASE WHEN v_bal < 0 THEN 'transfer_out' ELSE 'transfer_in' END,
              abs(v_bal), 'owner', CURRENT_DATE,
              'Balance transferred from former tenant', COALESCE(v_name, 'former tenant'), auth.uid());
    END IF;
  END IF;

  RETURN v_bal;  -- signed leftover that was moved onto the owner (0 = nothing)
END;
$$;

GRANT EXECUTE ON FUNCTION end_membership(UUID) TO authenticated;

COMMIT;

-- Post-run check: after removing a tenant who owed $2,300, the unit total is
-- unchanged, the tenant sub-ledger nets to 0, and the owner carries the -$2,300
-- with counterparty_name = the tenant's name.
--   SELECT kind, party, amount_usd, counterparty_name, note FROM adjustments
--   WHERE kind IN ('transfer_in','transfer_out') ORDER BY created_at DESC;
