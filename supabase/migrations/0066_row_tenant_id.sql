-- ============================================================
-- 0066_row_tenant_id.sql
-- Tie each tenant-attributed money row to the SPECIFIC tenant (person), so a
-- unit that cycles through tenants keeps a clean per-tenant history — the owner
-- can toggle to any tenant by name, defaulting to the current one.
--
-- Adds charges.tenant_id / payments.tenant_id / adjustments.tenant_id
-- (the tenant's profile id; NULL for owner rows). Backfills existing tenant rows
-- by occupancy dates, and tags the move-out transfer with the departing tenant.
--
-- Additive & idempotent. Transactional.
-- ============================================================
BEGIN;

ALTER TABLE charges     ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE payments    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE adjustments ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS charges_tenant_idx     ON charges(tenant_id)     WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_tenant_idx    ON payments(tenant_id)    WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS adjustments_tenant_idx ON adjustments(tenant_id) WHERE tenant_id IS NOT NULL;

-- ------------------------------------------------------------
-- Backfill: for each tenant-attributed row, the tenant whose occupancy dates
-- contain the row date; fall back to the unit's most recent tenant.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION tenant_on(p_unit UUID, p_date DATE)
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT user_id FROM (
    SELECT m.user_id,
           (m.created_at::date <= p_date AND (m.ended_at IS NULL OR m.ended_at::date >= p_date)) AS in_range,
           m.created_at
    FROM memberships m
    WHERE m.unit_id = p_unit AND m.tenure = 'tenant'
  ) s
  ORDER BY s.in_range DESC, s.created_at DESC
  LIMIT 1;
$$;

UPDATE charges c
   SET tenant_id = tenant_on(c.unit_id, c.charge_date)
 WHERE c.billed_to = 'tenant' AND c.tenant_id IS NULL;

UPDATE payments p
   SET tenant_id = tenant_on(p.unit_id, p.paid_on)
 WHERE p.paid_by = 'tenant' AND p.tenant_id IS NULL;

UPDATE adjustments a
   SET tenant_id = tenant_on(a.unit_id, a.effective_date)
 WHERE a.party = 'tenant' AND a.tenant_id IS NULL;

-- ------------------------------------------------------------
-- end_membership: tag the tenant-zeroing transfer with the departing tenant's id
-- (same behaviour as 0065, plus tenant_id). Returns the moved amount.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION end_membership(p_membership UUID)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_unit UUID; v_building UUID; v_tenure TEXT; v_user UUID;
  v_bal NUMERIC := 0; v_name TEXT;
BEGIN
  SELECT m.unit_id, m.tenure, m.user_id, u.building_id
    INTO v_unit, v_tenure, v_user, v_building
    FROM memberships m JOIN units u ON u.id = m.unit_id
   WHERE m.id = p_membership;

  IF v_unit IS NULL THEN RAISE EXCEPTION 'Membership not found.' USING ERRCODE = '42501'; END IF;
  IF auth.uid() IS NOT NULL AND NOT user_can(v_building, 'resident.manage') THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;

  UPDATE memberships SET ended_at = now() WHERE id = p_membership AND ended_at IS NULL;

  IF v_tenure = 'tenant' THEN
    v_bal := unit_party_balance(v_unit, 'tenant');
    IF v_bal <> 0 THEN
      SELECT full_name INTO v_name FROM profiles WHERE id = v_user;

      INSERT INTO adjustments (unit_id, building_id, kind, amount_usd, party, tenant_id, effective_date, note, counterparty_name, created_by)
      VALUES (v_unit, v_building,
              CASE WHEN v_bal < 0 THEN 'transfer_in' ELSE 'transfer_out' END,
              abs(v_bal), 'tenant', v_user, CURRENT_DATE,
              'Moved out — balance transferred to owner', COALESCE(v_name, 'former tenant'), auth.uid());

      INSERT INTO adjustments (unit_id, building_id, kind, amount_usd, party, effective_date, note, counterparty_name, created_by)
      VALUES (v_unit, v_building,
              CASE WHEN v_bal < 0 THEN 'transfer_out' ELSE 'transfer_in' END,
              abs(v_bal), 'owner', CURRENT_DATE,
              'Balance transferred from former tenant', COALESCE(v_name, 'former tenant'), auth.uid());
    END IF;
  END IF;

  RETURN v_bal;
END;
$$;

GRANT EXECUTE ON FUNCTION end_membership(UUID) TO authenticated;

COMMIT;

-- Post-run check: tenant rows now carry a tenant_id.
--   SELECT count(*) FILTER (WHERE tenant_id IS NULL) AS missing, count(*) AS total
--   FROM charges WHERE billed_to = 'tenant';
