-- ============================================================
-- 0056_payment_reminder_schedule.sql
-- Automated dues/arrears reminders, done politely:
--   1. buildings.reminder_day (1..28, NULL = off) — each building opts in and
--      picks its monthly reminder day. Default OFF.
--   2. reminders_sent log — hard guarantee of ONE reminder per unit per month
--      (unique index), and an audit trail managers can read.
--   3. get_overdue_units / get_overdue_dues rebuilt on the CANONICAL balance
--      (opening + payments − charges + adjustments, voids excluded — the 0023
--      versions predate all of that), filtered to buildings whose reminder day
--      is today (Asia/Beirut), effective billing mode respected (compound
--      overrides block), ended memberships excluded, already-reminded skipped.
--
-- The send-reminders edge function calls these with the service role;
-- EXECUTE stays revoked from clients (as 0043 established).
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Per-building schedule
-- ------------------------------------------------------------
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS reminder_day INT
  CHECK (reminder_day BETWEEN 1 AND 28);

-- ------------------------------------------------------------
-- 2. Sent log (once per unit per month)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reminders_sent (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id     UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  period      TEXT NOT NULL,              -- 'YYYY-MM' (Asia/Beirut)
  amount_usd  NUMERIC(12,2) NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS reminders_sent_once_idx
  ON reminders_sent(unit_id, period);

ALTER TABLE reminders_sent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reminders_sent_select" ON reminders_sent;
CREATE POLICY "reminders_sent_select" ON reminders_sent
  FOR SELECT TO authenticated USING (
    is_platform_admin() OR user_can(building_id, 'finance.view')
  );
-- no INSERT/UPDATE/DELETE policies: only the service role (cron) writes.

-- ------------------------------------------------------------
-- 3. Candidate queries (canonical, scheduled, deduped)
-- ------------------------------------------------------------
-- Effective billing mode: the compound's mode governs its blocks.
CREATE OR REPLACE FUNCTION effective_billing_mode(p_building UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(c.billing_mode, b.billing_mode)
  FROM buildings b
  LEFT JOIN compounds c ON c.id = b.compound_id
  WHERE b.id = p_building;
$$;

DROP FUNCTION IF EXISTS get_overdue_units();
CREATE FUNCTION get_overdue_units()
RETURNS TABLE (
  unit_id        UUID,
  unit_label     TEXT,
  building_id    UUID,
  building_name  TEXT,
  balance_usd    NUMERIC,      -- amount OWED (positive)
  owner_user_ids UUID[]
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH today AS (
    SELECT EXTRACT(DAY FROM (now() AT TIME ZONE 'Asia/Beirut'))::INT AS d,
           to_char(now() AT TIME ZONE 'Asia/Beirut', 'YYYY-MM')      AS period
  )
  SELECT
    u.id, u.label, b.id, b.name,
    -unit_balance(u.id) AS balance_usd,   -- negative balance = owed
    COALESCE((
      SELECT ARRAY_AGG(DISTINCT m.user_id) FROM memberships m
      WHERE m.unit_id = u.id AND m.ended_at IS NULL
    ), ARRAY[]::UUID[])
  FROM units u
  JOIN buildings b ON b.id = u.building_id AND b.is_active = true
  CROSS JOIN today t
  WHERE b.reminder_day = t.d
    AND effective_billing_mode(b.id) = 'arrears'
    AND unit_balance(u.id) < 0
    AND NOT EXISTS (
      SELECT 1 FROM reminders_sent rs
      WHERE rs.unit_id = u.id AND rs.period = t.period
    );
$$;

DROP FUNCTION IF EXISTS get_overdue_dues();
CREATE FUNCTION get_overdue_dues()
RETURNS TABLE (
  unit_id        UUID,
  unit_label     TEXT,
  building_id    UUID,
  building_name  TEXT,
  period_label   TEXT,
  due_date       DATE,
  amount_due     NUMERIC,      -- still owed on the latest overdue dues
  owner_user_ids UUID[]
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH today AS (
    SELECT EXTRACT(DAY FROM (now() AT TIME ZONE 'Asia/Beirut'))::INT AS d,
           to_char(now() AT TIME ZONE 'Asia/Beirut', 'YYYY-MM')      AS period
  ),
  latest_due AS (
    SELECT DISTINCT ON (d.unit_id) d.*
    FROM dues d
    WHERE d.due_date IS NOT NULL AND d.due_date < CURRENT_DATE AND d.amount_due > 0
    ORDER BY d.unit_id, d.due_date DESC
  )
  SELECT
    ld.unit_id, u.label, b.id, b.name, ld.period_label, ld.due_date,
    GREATEST(0, ROUND(ld.amount_due - COALESCE((
      SELECT SUM(p.amount_usd) FROM payments p
      WHERE p.unit_id = ld.unit_id AND p.voided_at IS NULL
        AND p.created_at >= ld.created_at
    ), 0), 2)) AS amount_due,
    COALESCE((
      SELECT ARRAY_AGG(DISTINCT m.user_id) FROM memberships m
      WHERE m.unit_id = ld.unit_id AND m.ended_at IS NULL
    ), ARRAY[]::UUID[])
  FROM latest_due ld
  JOIN units u ON u.id = ld.unit_id
  JOIN buildings b ON b.id = ld.building_id AND b.is_active = true
  CROSS JOIN today t
  WHERE b.reminder_day = t.d
    AND effective_billing_mode(b.id) = 'dues'
    AND GREATEST(0, ROUND(ld.amount_due - COALESCE((
      SELECT SUM(p.amount_usd) FROM payments p
      WHERE p.unit_id = ld.unit_id AND p.voided_at IS NULL
        AND p.created_at >= ld.created_at
    ), 0), 2)) > 0
    AND NOT EXISTS (
      SELECT 1 FROM reminders_sent rs
      WHERE rs.unit_id = ld.unit_id AND rs.period = t.period
    );
$$;

-- Cron helpers stay service-only (0043 discipline).
REVOKE ALL ON FUNCTION get_overdue_units()          FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION get_overdue_dues()           FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION effective_billing_mode(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION effective_billing_mode(UUID) TO authenticated;

COMMIT;

-- ============================================================
-- SCHEDULING (one-time, run separately in the SQL Editor):
-- Enable the pg_cron + pg_net extensions (Dashboard → Database → Extensions),
-- then schedule the daily run at 06:00 UTC (≈ 9am Beirut):
--
--   SELECT cron.schedule(
--     'daily-reminders',
--     '0 6 * * *',
--     $$
--     SELECT net.http_post(
--       url     := 'https://miyrsnlpftybmudiuhbi.supabase.co/functions/v1/send-reminders',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer YOUR_CRON_SECRET_HERE'
--       ),
--       body    := '{}'::jsonb
--     );
--     $$
--   );
--
-- Replace YOUR_CRON_SECRET_HERE with the CRON_SECRET edge-function secret.
-- To inspect: SELECT * FROM cron.job;   To remove: SELECT cron.unschedule('daily-reminders');
-- ============================================================
