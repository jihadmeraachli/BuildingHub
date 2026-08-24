-- ============================================================
-- 0122_billing_rpc_anon_gaps.sql
-- Follow-up to 0119-0121, found while VERIFYING them live tonight.
--
-- Probing repost_expense() with the anon key (to confirm 0121 landed) got a
-- real "Expense not found" business error back instead of a permission
-- denial — meaning anon could EXECUTE it at all. Same root cause as C1:
-- Postgres grants EXECUTE to PUBLIC by default on CREATE FUNCTION, and every
-- function this week that only ever got `GRANT ... TO authenticated` (never
-- a prior REVOKE) kept that default PUBLIC grant underneath it. Checked the
-- rest of this week's billing/finance functions the same way:
--
--   · get_building_subscription(building) — WORSE: no internal gate at all.
--     Confirmed live: anon gets a real (empty-for-a-fake-id, but genuine)
--     query result. For a REAL building id this hands back the FULL
--     subscription row — status, plan, trial_ends_at, license_count,
--     auto_renew — to anyone, no login. This one gets a proper gate, not
--     just a REVOKE (mirrors building_book_asof's established pattern:
--     user_can() already cascades compound/org grants down to a building,
--     so a plain user_can(p_building,'finance.view') check is sufficient
--     and consistent).
--   · start_subscription / cancel_subscription / resume_subscription /
--     set_auto_renew / request_license_increase / schedule_license_reduction
--     / cancel_license_reduction / create_payment_intent / repost_expense —
--     all already have a real internal caller check (user_manages_subscription
--     / expense.manage), so for a REAL target anon still gets rejected. This
--     is REVOKE-only hygiene: no gate logic changes, no risk to authenticated
--     callers (re-granted explicitly, same as before).
--
-- NOT fixed here — flagged for the next pass, not rushed tonight:
--   subscription_monthly_cents / subscription_price_cents /
--   subscription_unit_count have NO internal gate either (any authenticated
--   user can read any OTHER subscription's price/unit count by guessing a
--   uuid — the H1 shape, lower sensitivity). They are called internally by
--   many pricing paths across 0100/0114/0116-0121; gating them needs the
--   same internal-caller trace H1 got tonight, not a rushed add.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. get_building_subscription: add the gate building_book_asof already
--    uses, converting LANGUAGE sql -> plpgsql so it can RAISE.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_building_subscription(UUID);
CREATE FUNCTION get_building_subscription(p_building_id UUID)
RETURNS TABLE (id UUID, scope_type TEXT, status TEXT, plan TEXT, trial_ends_at TIMESTAMPTZ,
               current_period_start DATE, current_period_end DATE, grace_ends_at TIMESTAMPTZ,
               license_count INT, assigned_count BIGINT, available_count BIGINT, unit_count INT,
               auto_renew BOOLEAN, cancel_at_period_end BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF NOT (
    (auth.role() = 'service_role' OR current_user = 'service_role')
    OR is_platform_admin()
    OR user_can(p_building_id, 'finance.view')
  ) THEN
    RAISE EXCEPTION 'Not authorized for this building''s subscription.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.id, s.scope_type, s.status, s.plan, s.trial_ends_at, s.current_period_start, s.current_period_end, s.grace_ends_at,
           s.license_count,
           COUNT(la.id) FILTER (WHERE la.unassigned_at IS NULL),
           GREATEST(0, s.license_count - COUNT(la.id) FILTER (WHERE la.unassigned_at IS NULL))::BIGINT,
           subscription_unit_count(s.id), s.auto_renew, s.cancel_at_period_end
    FROM subscriptions s LEFT JOIN license_assignments la ON la.subscription_id = s.id
    WHERE s.id = building_subscription_id(p_building_id)
    GROUP BY s.id;
END;
$$;

-- ------------------------------------------------------------
-- 2. Close the anon/PUBLIC default-grant hole on everything else this week
--    added with only a plain GRANT ... TO authenticated. Each of these
--    already rejects an unauthorized caller internally — this REVOKE stops
--    anon from reaching that check at all, same standard as 0119.
-- ------------------------------------------------------------
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN
      ('get_building_subscription',
       'start_subscription', 'cancel_subscription', 'resume_subscription', 'set_auto_renew',
       'request_license_increase', 'schedule_license_reduction', 'cancel_license_reduction',
       'create_payment_intent', 'repost_expense')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION get_building_subscription(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION start_subscription(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_subscription(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION resume_subscription(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION set_auto_renew(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION request_license_increase(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION schedule_license_reduction(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_license_reduction(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_payment_intent(UUID, TEXT, TEXT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION repost_expense(UUID, JSONB, JSONB, TEXT) TO authenticated;

COMMIT;

-- Post-run checks:
--   Anon, fake building id: get_building_subscription -> 401 permission denied
--     (was: 200, empty array for a fake id — a real id would have returned data).
--   Anon: start_subscription / repost_expense / etc. -> 401 permission denied
--     (was: 400/401 APPLICATION error — proof anon reached the function body).
--   Signed in, own building: Structure.tsx's licence card still loads normally.
--   Signed in, own subscription: subscribe/renew/add/remove licences, and
--     editing an expense, all still work exactly as before.
