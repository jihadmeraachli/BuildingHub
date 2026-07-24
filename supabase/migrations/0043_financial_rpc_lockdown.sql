-- ============================================================
-- 0043_financial_rpc_lockdown.sql
-- Audit findings H4 + M3: several SECURITY DEFINER functions answered ANY
-- authenticated user about ANY tenant's finances, and the attachments bucket
-- kept stale 2023-era policies allowing cross-tenant overwrite.
--
--   1. get_overdue_units / get_overdue_dues / get_due_inspections — cron
--      helpers (send-reminders runs as service role): EXECUTE revoked from
--      app users entirely.
--   2. unit_balance / unit_balance_asof / building_book_asof /
--      user_outstanding — now require: service role, platform admin,
--      finance.view on the relevant building, or (for a unit) an active
--      membership on that unit / (for a user) being that user.
--      Semantics of the calculations are unchanged (0034 versions).
--   3. attachments bucket: drop the stale 0005 policies (bucket-wide write/
--      update survived 0025); non-platform users can no longer UPDATE
--      objects in place, DELETE stays platform-only. (Read isolation by
--      tenant path is a known remaining gap — needs a path-format audit
--      before it can be enforced without breaking existing files.)
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Cron helpers: service role only.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION get_overdue_units()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION get_overdue_dues()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION get_due_inspections(INT)   FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_overdue_units()        TO service_role;
GRANT  EXECUTE ON FUNCTION get_overdue_dues()         TO service_role;
GRANT  EXECUTE ON FUNCTION get_due_inspections(INT)   TO service_role;

-- ------------------------------------------------------------
-- 2. Caller checks on the balance functions.
--    Access rule for a unit: service role / platform admin / finance.view on
--    the unit's building / your own active membership on the unit.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION can_view_unit_finance(p_unit UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT auth.uid() IS NULL
      OR is_platform_admin()
      OR user_can((SELECT building_id FROM units WHERE id = p_unit), 'finance.view')
      OR EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.unit_id = p_unit AND m.user_id = auth.uid() AND m.ended_at IS NULL
        );
$$;

CREATE OR REPLACE FUNCTION unit_balance(p_unit UUID)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF NOT can_view_unit_finance(p_unit) THEN
    RAISE EXCEPTION 'Not authorized for this unit''s finances.' USING ERRCODE = '42501';
  END IF;
  RETURN ROUND(
      COALESCE((SELECT opening_balance FROM units WHERE id = p_unit), 0)
    + COALESCE((SELECT SUM(amount_usd) FROM payments WHERE unit_id = p_unit AND voided_at IS NULL), 0)
    - COALESCE((SELECT SUM(amount_usd) FROM charges  WHERE unit_id = p_unit AND voided_at IS NULL), 0)
    + COALESCE((SELECT SUM(adjustment_effect(kind, amount_usd)) FROM adjustments
                 WHERE unit_id = p_unit AND voided_at IS NULL), 0)
  , 2);
END;
$$;

CREATE OR REPLACE FUNCTION unit_balance_asof(p_unit UUID, p_asof DATE)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF NOT can_view_unit_finance(p_unit) THEN
    RAISE EXCEPTION 'Not authorized for this unit''s finances.' USING ERRCODE = '42501';
  END IF;
  RETURN ROUND(
      COALESCE((SELECT opening_balance FROM units
                 WHERE id = p_unit
                   AND (opening_balance_date IS NULL OR opening_balance_date <= p_asof)), 0)
    + COALESCE((SELECT SUM(amount_usd) FROM payments
                 WHERE unit_id = p_unit AND voided_at IS NULL AND paid_on     <= p_asof), 0)
    - COALESCE((SELECT SUM(amount_usd) FROM charges
                 WHERE unit_id = p_unit AND voided_at IS NULL AND charge_date <= p_asof), 0)
    + COALESCE((SELECT SUM(adjustment_effect(kind, amount_usd)) FROM adjustments
                 WHERE unit_id = p_unit AND voided_at IS NULL AND effective_date <= p_asof), 0)
  , 2);
END;
$$;

CREATE OR REPLACE FUNCTION building_book_asof(p_building UUID, p_asof DATE)
RETURNS TABLE(unit_id UUID, label TEXT, balance NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT is_platform_admin()
     AND NOT user_can(p_building, 'finance.view') THEN
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
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> p_user
     AND NOT is_platform_admin()
     AND NOT EXISTS (
           SELECT 1 FROM memberships m
           JOIN units u ON u.id = m.unit_id
           WHERE m.user_id = p_user AND m.ended_at IS NULL
             AND user_can(u.building_id, 'finance.view')
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
-- 3. Storage: retire the stale 0005 policies on the attachments bucket.
--    (0025 replaced read/insert/delete but 0005's write/update survived.)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "attachments_write"  ON storage.objects;
DROP POLICY IF EXISTS "attachments_update" ON storage.objects;

COMMIT;

-- ============================================================
-- Post-run checks:
--   -- As a resident (app console):
--   1. supabase.rpc('unit_balance', {p_unit: '<own unit>'})   → number
--   2. supabase.rpc('unit_balance', {p_unit: '<other unit>'}) → 'Not authorized'
--   3. supabase.rpc('get_overdue_units')                      → permission denied
--   -- Cron: trigger send-reminders once and confirm it still runs clean.
-- ============================================================
