-- ============================================================
-- 0072_dashboard_period.sql
-- The manager Dashboard gains a period filter, so the aggregate RPCs need to
-- take one. They could not be filtered client-side: 0049 moved this work into
-- the DB precisely because pulling every charge/payment row hits PostgREST's
-- silent 1000-row cap and produces WRONG totals.
--
-- THE RULE, and it is not uniform across the KPIs:
--
--   FLOWS are summed INSIDE the window.
--     billed, collected, the monthly series.
--
--   POSITIONS are taken AS OF the window's last day. A balance is not a sum of
--     a window - "outstanding in July" means what was outstanding on Jul 31,
--     not the net of July's movements. Same reasoning as the resident-side
--     "you owe" fix.
--     outstanding, carry (fund balance).
--
--   COUNTS are the population LIVE at the window's last day, not today.
--     units (a unit created after the period did not exist in it - and it is
--     the denominator for per-unit figures, so counting today's units against
--     a historical period silently misstates them), and open issues (open at
--     that date = created by then, not resolved until after).
--
-- Passing NULL for both bounds reproduces the old behaviour exactly, so an
-- un-updated caller is unaffected. The 1-arg signatures are dropped and
-- recreated WITH DEFAULTS rather than overloaded, because an overload plus a
-- default is ambiguous to the resolver. Same names, same columns + none
-- removed, so this is a superset - not a destructive change.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- Old signatures give way to the defaulted ones (see header).
DROP FUNCTION IF EXISTS dashboard_stats(UUID[]);
DROP FUNCTION IF EXISTS dashboard_monthly(UUID[]);
DROP FUNCTION IF EXISTS dashboard_carry(UUID[]);

-- ------------------------------------------------------------
-- Headline stats. p_from/p_to NULL = all time (previous behaviour).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION dashboard_stats(
  p_building_ids UUID[],
  p_from         DATE DEFAULT NULL,
  p_to           DATE DEFAULT NULL
)
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
  v_to  DATE := COALESCE(p_to, CURRENT_DATE);
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
    -- FLOW: billed inside the window
    COALESCE((SELECT ROUND(SUM(c.amount_usd), 2) FROM charges c
              WHERE c.building_id = ANY(v_ids) AND c.voided_at IS NULL
                AND (p_from IS NULL OR c.charge_date >= p_from)
                AND (p_to   IS NULL OR c.charge_date <= p_to)), 0),
    -- FLOW: collected inside the window
    COALESCE((SELECT ROUND(SUM(p.amount_usd), 2) FROM payments p
              WHERE p.building_id = ANY(v_ids) AND p.voided_at IS NULL
                AND (p_from IS NULL OR p.paid_on >= p_from)
                AND (p_to   IS NULL OR p.paid_on <= p_to)), 0),
    -- POSITION: what was owed ON the window's last day. Reuses
    -- unit_balance_asof (0033) so it matches the client and the statements,
    -- including opening_balance_date handling.
    COALESCE((SELECT ROUND(SUM(GREATEST(0, -unit_balance_asof(u.id, v_to))), 2)
              FROM units u
              WHERE u.building_id = ANY(v_ids)
                AND u.created_at::date <= v_to), 0),
    -- year-to-date stays absolute: it is defined by the calendar, not the filter
    COALESCE((SELECT ROUND(SUM(p.amount_usd), 2) FROM payments p
              WHERE p.building_id = ANY(v_ids) AND p.voided_at IS NULL
                AND p.paid_on >= date_trunc('year', now())::date), 0),
    -- COUNT: units that existed at the window's last day
    (SELECT COUNT(*) FROM units u
      WHERE u.building_id = ANY(v_ids) AND u.created_at::date <= v_to),
    -- COUNT: issues open AT that date — raised by then and not yet resolved.
    -- (status alone is only ever "now"; resolved_at is what makes it historical.)
    (SELECT COUNT(*) FROM issues i
      WHERE i.building_id = ANY(v_ids)
        AND i.created_at::date <= v_to
        AND (i.resolved_at IS NULL OR i.resolved_at::date > v_to)),
    -- the most recent dues period ISSUED by that date
    COALESCE((SELECT d.period_label FROM dues d
              WHERE d.building_id = ANY(v_ids) AND d.created_at::date <= v_to
              ORDER BY d.created_at DESC LIMIT 1), ''),
    COALESCE((SELECT ROUND(SUM(d2.amount_due), 2) FROM dues d2
              WHERE d2.building_id = ANY(v_ids) AND d2.created_at::date <= v_to
                AND d2.period_label = (SELECT d.period_label FROM dues d
                                       WHERE d.building_id = ANY(v_ids)
                                         AND d.created_at::date <= v_to
                                       ORDER BY d.created_at DESC LIMIT 1)), 0);
END;
$$;

-- ------------------------------------------------------------
-- 12-month collected-vs-billed series ENDING at the window's last month, so
-- the chart follows the filter instead of always ending today.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION dashboard_monthly(
  p_building_ids UUID[],
  p_to           DATE DEFAULT NULL
)
RETURNS TABLE(month_start DATE, collected NUMERIC, spent NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_ids UUID[];
  v_end DATE := date_trunc('month', COALESCE(p_to, CURRENT_DATE))::date;
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
         (v_end - INTERVAL '11 months'),
         v_end,
         INTERVAL '1 month'
       ) AS m(month_start)
  ORDER BY m.month_start;
END;
$$;

-- ------------------------------------------------------------
-- Net carry (opening balances + adjustments) AS OF the window's last day —
-- a position, so it follows the same rule as `outstanding`.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION dashboard_carry(
  p_building_ids UUID[],
  p_to           DATE DEFAULT NULL
)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_ids UUID[];
  v_to  DATE := COALESCE(p_to, CURRENT_DATE);
BEGIN
  SELECT array_agg(id) INTO v_ids
  FROM unnest(p_building_ids) AS id
  WHERE is_platform_admin() OR user_can(id, 'finance.view');

  IF v_ids IS NULL THEN RETURN 0; END IF;

  RETURN ROUND(
      COALESCE((SELECT SUM(u.opening_balance) FROM units u
                 WHERE u.building_id = ANY(v_ids)
                   AND u.created_at::date <= v_to
                   AND (u.opening_balance_date IS NULL OR u.opening_balance_date <= v_to)), 0)
    + COALESCE((SELECT SUM(adjustment_effect(a.kind, a.amount_usd)) FROM adjustments a
                 WHERE a.building_id = ANY(v_ids) AND a.voided_at IS NULL
                   AND a.effective_date <= v_to), 0)
  , 2);
END;
$$;

GRANT EXECUTE ON FUNCTION dashboard_stats(UUID[], DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_monthly(UUID[], DATE)     TO authenticated;
GRANT EXECUTE ON FUNCTION dashboard_carry(UUID[], DATE)       TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks (as a manager, in the app console):
--   supabase.rpc('dashboard_stats', {p_building_ids:['<id>']})
--     -> unchanged from before this migration (both bounds default to NULL)
--   supabase.rpc('dashboard_stats', {p_building_ids:['<id>'], p_to:'2026-01-31'})
--     -> units/open_issues reflect January, outstanding is the Jan 31 position
--   A unit created in March must NOT be counted with p_to = January.
-- ============================================================
