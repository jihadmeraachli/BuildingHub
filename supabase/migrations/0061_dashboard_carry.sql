-- ============================================================
-- 0061_dashboard_carry.sql
-- Dashboard "Fund balance" should reflect units that joined with a balance.
--
-- dashboard_stats (0049) already folds opening balances into OUTSTANDING, but the
-- hero "Fund balance" on the home page is collected − spent, which ignores both
-- opening balances and non-cash adjustments. So entering a unit's starting
-- balance didn't move the headline (T2).
--
-- This returns the net "carry" for a scope = Σ opening_balance + Σ adjustment
-- effect (non-voided). The client adds it: fund = collected − spent + carry,
-- which equals the true sum of every unit's balance. Units are bounded per
-- building and adjustments are indexed by building_id, so this stays cheap —
-- no unbounded row fetch (keeps the 0049 server-aggregation approach).
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION dashboard_carry(p_building_ids UUID[])
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_ids UUID[];
BEGIN
  -- same visibility gate as dashboard_stats
  SELECT array_agg(id) INTO v_ids
  FROM unnest(p_building_ids) AS id
  WHERE is_platform_admin() OR user_can(id, 'finance.view');

  IF v_ids IS NULL THEN RETURN 0; END IF;

  RETURN ROUND(
      COALESCE((SELECT SUM(u.opening_balance) FROM units u
                 WHERE u.building_id = ANY(v_ids)), 0)
    + COALESCE((SELECT SUM(adjustment_effect(a.kind, a.amount_usd)) FROM adjustments a
                 WHERE a.building_id = ANY(v_ids) AND a.voided_at IS NULL), 0)
  , 2);
END;
$$;

GRANT EXECUTE ON FUNCTION dashboard_carry(UUID[]) TO authenticated;

COMMIT;

-- Post-run check (as a manager in the app console):
--   supabase.rpc('dashboard_carry', { p_building_ids: ['<building-id>'] })
--   -- should equal Σ opening balances + Σ adjustment effects for that scope.
