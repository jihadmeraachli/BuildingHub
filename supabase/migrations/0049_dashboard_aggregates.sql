-- ============================================================
-- 0049_dashboard_aggregates.sql
-- Scalability + correctness: the manager Dashboard pulled EVERY charge and
-- payment row to the browser and summed there — PostgREST silently caps
-- responses at 1000 rows, so a scope with real history would show WRONG
-- totals. These RPCs answer with numbers instead of rows.
--
-- Auth model: SECURITY DEFINER, but the requested building ids are first
-- filtered to those the caller may view (platform admin, or finance.view via
-- user_can — building/compound/org grants all cascade). Unauthorized ids are
-- silently dropped, so the result is exactly "what this caller may see".
--
-- Note: `outstanding` uses the CANONICAL balance (opening_balance + payments
-- − charges + adjustments, voided excluded — same as unit_balance()/0034).
-- The old client-side version ignored opening balances and adjustments, so
-- this number may shift slightly — it is now correct, not just fast.
--
-- Additive & idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- Headline stats for a set of buildings (entity scope or "all").
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION dashboard_stats(p_building_ids UUID[])
RETURNS TABLE(
  billed       NUMERIC,
  collected    NUMERIC,
  outstanding  NUMERIC,
  ytd          NUMERIC,
  units        BIGINT,
  open_issues  BIGINT,
  dues_period  TEXT,
  dues_issued  NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_ids UUID[];
BEGIN
  SELECT array_agg(id) INTO v_ids
  FROM unnest(p_building_ids) AS id
  WHERE is_platform_admin() OR user_can(id, 'finance.view');

  IF v_ids IS NULL THEN
    RETURN QUERY SELECT 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC,
                        0::BIGINT, 0::BIGINT, ''::TEXT, 0::NUMERIC;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE((SELECT ROUND(SUM(c.amount_usd), 2) FROM charges c
              WHERE c.building_id = ANY(v_ids) AND c.voided_at IS NULL), 0),
    COALESCE((SELECT ROUND(SUM(p.amount_usd), 2) FROM payments p
              WHERE p.building_id = ANY(v_ids) AND p.voided_at IS NULL), 0),
    COALESCE((SELECT ROUND(SUM(GREATEST(0, -x.bal)), 2) FROM (
      SELECT u.opening_balance
        + COALESCE((SELECT SUM(p.amount_usd) FROM payments p
                    WHERE p.unit_id = u.id AND p.voided_at IS NULL), 0)
        - COALESCE((SELECT SUM(c.amount_usd) FROM charges c
                    WHERE c.unit_id = u.id AND c.voided_at IS NULL), 0)
        + COALESCE((SELECT SUM(adjustment_effect(a.kind, a.amount_usd)) FROM adjustments a
                    WHERE a.unit_id = u.id AND a.voided_at IS NULL), 0) AS bal
      FROM units u WHERE u.building_id = ANY(v_ids)
    ) x WHERE x.bal < 0), 0),
    COALESCE((SELECT ROUND(SUM(p.amount_usd), 2) FROM payments p
              WHERE p.building_id = ANY(v_ids) AND p.voided_at IS NULL
                AND p.paid_on >= date_trunc('year', now())::date), 0),
    (SELECT COUNT(*) FROM units u WHERE u.building_id = ANY(v_ids)),
    (SELECT COUNT(*) FROM issues i WHERE i.building_id = ANY(v_ids) AND i.status = 'open'),
    COALESCE((SELECT d.period_label FROM dues d
              WHERE d.building_id = ANY(v_ids)
              ORDER BY d.created_at DESC LIMIT 1), ''),
    COALESCE((SELECT ROUND(SUM(d2.amount_due), 2) FROM dues d2
              WHERE d2.building_id = ANY(v_ids)
                AND d2.period_label = (SELECT d.period_label FROM dues d
                                       WHERE d.building_id = ANY(v_ids)
                                       ORDER BY d.created_at DESC LIMIT 1)), 0);
END;
$$;

-- ------------------------------------------------------------
-- Last-12-months collected vs billed, one row per month (oldest first).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION dashboard_monthly(p_building_ids UUID[])
RETURNS TABLE(month_start DATE, collected NUMERIC, spent NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_ids UUID[];
BEGIN
  SELECT array_agg(id) INTO v_ids
  FROM unnest(p_building_ids) AS id
  WHERE is_platform_admin() OR user_can(id, 'finance.view');

  RETURN QUERY
  SELECT
    m.month_start::date,
    COALESCE((SELECT ROUND(SUM(p.amount_usd), 2) FROM payments p
              WHERE p.building_id = ANY(COALESCE(v_ids, '{}')) AND p.voided_at IS NULL
                AND p.paid_on >= m.month_start
                AND p.paid_on < (m.month_start + INTERVAL '1 month')::date), 0),
    COALESCE((SELECT ROUND(SUM(c.amount_usd), 2) FROM charges c
              WHERE c.building_id = ANY(COALESCE(v_ids, '{}')) AND c.voided_at IS NULL
                AND c.charge_date >= m.month_start
                AND c.charge_date < (m.month_start + INTERVAL '1 month')::date), 0)
  FROM generate_series(
         date_trunc('month', now()) - INTERVAL '11 months',
         date_trunc('month', now()),
         INTERVAL '1 month'
       ) AS m(month_start)
  ORDER BY m.month_start;
END;
$$;

GRANT EXECUTE ON FUNCTION dashboard_stats(UUID[])   TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_monthly(UUID[]) TO authenticated;

-- ============================================================
-- Post-run checks (as a manager in the app console):
--   supabase.rpc('dashboard_stats',   {p_building_ids: ['<building-id>']})
--   supabase.rpc('dashboard_monthly', {p_building_ids: ['<building-id>']})
--   -- numbers must match the dashboard; a building you don't manage
--   -- contributes nothing (silently filtered).
-- ============================================================
