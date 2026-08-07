-- ============================================================
-- 0097_party_read_scope.sql
-- A tenant stops being able to read the owner's money (2026-08-07).
--
-- THE LEAK. charges, payments and adjustments all scope resident reads the
-- same way:
--
--     user_can(building_id, 'finance.view') OR unit_id IN (SELECT user_unit_ids())
--
-- Membership of the unit is the whole test, so ANY member sees EVERY row on
-- it, whichever party it belongs to. A tenant can read the owner's payments,
-- charges and discounts through the API. The screens already split owner and
-- tenant sub-ledgers, and docs/REPORTING_GUIDANCE.md states the rule outright
-- ("a tenant's report never shows the owner's money and vice versa") — but it
-- was never enforced anywhere except the UI, so any filter built on top of it
-- is decoration.
--
-- THE RULE, matching how the money model already splits parties (0064/0088):
--   · manager (finance.view)  — everything, unchanged
--   · OWNER of the unit       — everything on that unit, including the tenant
--                               sub-ledger. An owner needs to know whether
--                               their tenant paid; that is the point of the
--                               split, not a leak.
--   · TENANT of the unit      — ONLY rows that are theirs: party = tenant AND
--                               named as that tenant.
--
-- `billed_to = 'both'` stays with the OWNER, which is already how
-- unit_party_balance_asof (0088) buckets it — the owner party counts
-- ('owner','both'), the tenant party counts 'tenant' only. This migration does
-- not invent a rule, it enforces the existing one.
--
-- LEGACY ROWS. tenant_id arrived in 0066; rows written before it have NULL.
-- Those are admitted to any tenant of the unit, or a tenant would lose their
-- own history. Where a unit has had SEQUENTIAL tenants, a legacy row is
-- genuinely ambiguous and both can see it — unavoidable without inventing
-- attribution, and it only affects rows predating 0066.
--
-- NOT CHANGED HERE: dues_select also carries `OR user_member_building(...)`,
-- so any resident of the building can read EVERY unit's dues. That may be
-- deliberate transparency (committees post the list) — it needs a product
-- decision, not a silent tightening. Flagged in docs/HANDOFF.md.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- SECURITY DEFINER so the policies do not re-enter RLS on memberships and
-- recurse — the same reason user_can() and user_sees_building() (0096) are.
DROP FUNCTION IF EXISTS user_owns_unit(UUID);
CREATE FUNCTION user_owns_unit(p_unit UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE unit_id = p_unit AND user_id = auth.uid()
      AND tenure = 'owner' AND ended_at IS NULL);
$$;
GRANT EXECUTE ON FUNCTION user_owns_unit(UUID) TO authenticated;

-- Ended tenancies included on purpose: a former tenant keeps access to their
-- OWN history, which the tenant_id test below still pins to them.
DROP FUNCTION IF EXISTS user_tenants_unit(UUID);
CREATE FUNCTION user_tenants_unit(p_unit UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE unit_id = p_unit AND user_id = auth.uid() AND tenure = 'tenant');
$$;
GRANT EXECUTE ON FUNCTION user_tenants_unit(UUID) TO authenticated;

-- ---- charges ------------------------------------------------
DROP POLICY IF EXISTS charges_select ON charges;
CREATE POLICY charges_select ON charges FOR SELECT USING (
  user_can(building_id, 'finance.view')
  OR user_owns_unit(unit_id)
  OR (user_tenants_unit(unit_id)
      AND billed_to = 'tenant'
      AND (tenant_id = auth.uid() OR tenant_id IS NULL))
);

-- ---- payments -----------------------------------------------
DROP POLICY IF EXISTS payments_select ON payments;
CREATE POLICY payments_select ON payments FOR SELECT USING (
  user_can(building_id, 'finance.view')
  OR user_owns_unit(unit_id)
  OR (user_tenants_unit(unit_id)
      AND paid_by = 'tenant'
      AND (tenant_id = auth.uid() OR tenant_id IS NULL))
);

-- ---- adjustments (discounts / penalties, 0034) ---------------
DROP POLICY IF EXISTS adjustments_select ON adjustments;
CREATE POLICY adjustments_select ON adjustments FOR SELECT USING (
  user_can(building_id, 'finance.view')
  OR user_owns_unit(unit_id)
  OR (user_tenants_unit(unit_id)
      AND party = 'tenant'
      AND (tenant_id = auth.uid() OR tenant_id IS NULL))
);

COMMIT;

-- ============================================================
-- Post-run checks:
--   As a TENANT: Finance → My home and Reports show only their own charges and
--   payments. The owner's rows are gone from the API too, not just the screen:
--     SELECT count(*) FROM payments WHERE unit_id = '<their unit>' AND paid_by = 'owner';
--   → 0.
--   As the OWNER of a leased unit: still sees both sub-ledgers, so "has my
--   tenant paid" still works.
--   As a MANAGER: unchanged.
--
--   Watch for: a tenant's balance shifting, because it is now computed from
--   their rows alone. That is the intended correction, not a regression.
-- ============================================================
