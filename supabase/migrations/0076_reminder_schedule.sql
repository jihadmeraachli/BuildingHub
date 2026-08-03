-- ============================================================
-- 0076_reminder_schedule.sql
-- Payment reminders become a BILLING CYCLE WITH A WINDOW, not a single-day nag.
--
-- Before: buildings.reminder_day (1-28). The cron fired on that one day of the
-- month, for arrears and dues alike, and said nothing about which period was
-- being settled.
--
-- After, per Jihad + Ahmad's model:
--
--   ARREARS - the ask references the period that just CLOSED.
--     "notice on the 1st, due the 7th" => on 1 Aug residents are asked to settle
--     their JULY balance, and are reminded DAILY until the 7th. The amount
--     quoted is the balance AS OF the period close (31 Jul), not today's - by
--     3 Aug the live balance may already include August charges, so quoting it
--     under a "your July balance" heading would be wrong.
--
--   DUES - the dues row already carries its own due_date, so the window is
--     issue date -> due date, reminded daily.
--
--   AFTER THE DUE DATE, both fall back to WEEKLY until paid or until the next
--   cycle's notice replaces them. Daily forever reads as harassment; silence
--   is the opposite of a collections tool.
--
--   A building in DUES mode never gets the arrears "settle your balance" ask:
--   a b1 plan already nets the balance into amount_due via the carry-in
--   true-up, so both together would demand the same money twice.
--
-- ⚠️ THE DEDUP KEY HAD TO CHANGE. reminders_sent was unique per (unit, MONTH,
-- party) and send-reminders treats a duplicate-key error as "already sent".
-- Daily sending through a window would have fired on day one and then gone
-- silent for the rest of the month with no error anywhere - the same class of
-- silent failure as the owner/tenant collision fixed in 0070. The key is now
-- the actual send DATE.
--
-- WHO MAY SET IT: `charge.manage`, not `building.manage`. Admins and the
-- finance roles both hold it and collections is finance's job; the ناطور
-- (building_super) and viewers hold neither. Rather than loosening the
-- buildings UPDATE policy - which would also hand finance the building name and
-- address - the schedule is written through a SECURITY DEFINER RPC that checks
-- exactly that one capability (the sealed-helper discipline from 0047).
--
-- Additive & idempotent. Existing buildings keep their current behaviour:
-- reminder_day N backfills to monthly/notice day N, and grace 0 reproduces the
-- old single-day fire until someone widens the window.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Schedule columns, on BOTH levels. The compound governs its blocks, the
--    same cascade billing_mode already uses.
-- ------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['buildings','compounds'] LOOP
    EXECUTE format($f$
      ALTER TABLE %I ADD COLUMN IF NOT EXISTS reminder_frequency TEXT;
      ALTER TABLE %I ADD COLUMN IF NOT EXISTS reminder_notice_day INT;
      ALTER TABLE %I ADD COLUMN IF NOT EXISTS reminder_weekday INT;
      ALTER TABLE %I ADD COLUMN IF NOT EXISTS reminder_month_of_quarter INT;
      ALTER TABLE %I ADD COLUMN IF NOT EXISTS reminder_grace_days INT;
    $f$, t, t, t, t, t);

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_reminder_freq_chk');
    EXECUTE format($f$ALTER TABLE %I ADD CONSTRAINT %I
      CHECK (reminder_frequency IS NULL OR reminder_frequency IN ('off','weekly','monthly','quarterly'))$f$,
      t, t || '_reminder_freq_chk');

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_reminder_day_chk');
    EXECUTE format($f$ALTER TABLE %I ADD CONSTRAINT %I
      CHECK (reminder_notice_day IS NULL OR reminder_notice_day BETWEEN 1 AND 28)$f$,
      t, t || '_reminder_day_chk');

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_reminder_dow_chk');
    EXECUTE format($f$ALTER TABLE %I ADD CONSTRAINT %I
      CHECK (reminder_weekday IS NULL OR reminder_weekday BETWEEN 0 AND 6)$f$,
      t, t || '_reminder_dow_chk');

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_reminder_moq_chk');
    EXECUTE format($f$ALTER TABLE %I ADD CONSTRAINT %I
      CHECK (reminder_month_of_quarter IS NULL OR reminder_month_of_quarter BETWEEN 1 AND 3)$f$,
      t, t || '_reminder_moq_chk');

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_reminder_grace_chk');
    EXECUTE format($f$ALTER TABLE %I ADD CONSTRAINT %I
      CHECK (reminder_grace_days IS NULL OR reminder_grace_days BETWEEN 0 AND 28)$f$,
      t, t || '_reminder_grace_chk');
  END LOOP;
END $$;

COMMENT ON COLUMN buildings.reminder_frequency IS
  'off | weekly | monthly | quarterly. The billing cycle the arrears reminder follows. NULL = inherit the compound, then off.';
COMMENT ON COLUMN buildings.reminder_notice_day IS
  'Day of month (1-28) the ask goes out, for monthly/quarterly.';
COMMENT ON COLUMN buildings.reminder_weekday IS
  'Day of week (0=Sunday) the ask goes out, for weekly.';
COMMENT ON COLUMN buildings.reminder_month_of_quarter IS
  'Which month of the quarter (1-3) carries the notice, for quarterly.';
COMMENT ON COLUMN buildings.reminder_grace_days IS
  'Days from notice to due. Reminders go DAILY across that window, weekly after it.';

-- Existing schedules keep working untouched: reminder_day N == monthly on N.
-- grace 0 reproduces the old single-day fire exactly.
UPDATE buildings
   SET reminder_frequency  = 'monthly',
       reminder_notice_day = reminder_day,
       reminder_grace_days = COALESCE(reminder_grace_days, 0)
 WHERE reminder_day IS NOT NULL AND reminder_frequency IS NULL;

UPDATE buildings SET reminder_frequency = 'off'
 WHERE reminder_day IS NULL AND reminder_frequency IS NULL;

-- ------------------------------------------------------------
-- 2. Effective schedule: the compound governs its blocks (billing_mode cascade).
--    A compound value counts only when the compound actually sets one.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS effective_reminder(UUID);
CREATE FUNCTION effective_reminder(p_building UUID)
RETURNS TABLE (
  frequency        TEXT,
  notice_day       INT,
  weekday          INT,
  month_of_quarter INT,
  grace_days       INT
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    COALESCE(NULLIF(c.reminder_frequency, 'off'), c.reminder_frequency, b.reminder_frequency, 'off'),
    COALESCE(c.reminder_notice_day,       b.reminder_notice_day, 1),
    COALESCE(c.reminder_weekday,          b.reminder_weekday, 1),
    COALESCE(c.reminder_month_of_quarter, b.reminder_month_of_quarter, 1),
    COALESCE(c.reminder_grace_days,       b.reminder_grace_days, 7)
  FROM buildings b
  LEFT JOIN compounds c ON c.id = b.compound_id
  WHERE b.id = p_building;
$$;

-- ------------------------------------------------------------
-- 3. The current cycle for a building on a given day.
--    notice_date = the most recent scheduled notice ON OR BEFORE p_today.
--    period_end  = the day before it — the close of the period being settled,
--                  which is what the amount must be quoted as of.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS reminder_cycle(UUID, DATE);
CREATE FUNCTION reminder_cycle(p_building UUID, p_today DATE)
RETURNS TABLE (notice_date DATE, due_date DATE, period_end DATE)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  s RECORD;
  v_notice DATE;
  v_qstart DATE;
BEGIN
  SELECT * INTO s FROM effective_reminder(p_building);
  IF s.frequency IS NULL OR s.frequency = 'off' THEN RETURN; END IF;

  IF s.frequency = 'weekly' THEN
    -- step back to the most recent occurrence of that weekday
    v_notice := p_today - ((EXTRACT(DOW FROM p_today)::INT - s.weekday + 7) % 7);

  ELSIF s.frequency = 'monthly' THEN
    v_notice := date_trunc('month', p_today)::DATE + (s.notice_day - 1);
    IF v_notice > p_today THEN
      v_notice := (date_trunc('month', p_today) - INTERVAL '1 month')::DATE + (s.notice_day - 1);
    END IF;

  ELSE -- quarterly
    v_qstart := date_trunc('quarter', p_today)::DATE;
    v_notice := (v_qstart + ((s.month_of_quarter - 1) || ' months')::INTERVAL)::DATE + (s.notice_day - 1);
    IF v_notice > p_today THEN
      v_qstart := (v_qstart - INTERVAL '3 months')::DATE;
      v_notice := (v_qstart + ((s.month_of_quarter - 1) || ' months')::INTERVAL)::DATE + (s.notice_day - 1);
    END IF;
  END IF;

  RETURN QUERY SELECT v_notice, (v_notice + s.grace_days)::DATE, (v_notice - 1)::DATE;
END;
$$;

/** Is today a send day? Daily inside [notice, due]; weekly on the same beat after. */
DROP FUNCTION IF EXISTS reminder_is_send_day(DATE, DATE, DATE);
CREATE FUNCTION reminder_is_send_day(p_today DATE, p_notice DATE, p_due DATE)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_today < p_notice THEN FALSE
    WHEN p_today <= p_due   THEN TRUE                        -- daily in the window
    ELSE ((p_today - p_due) % 7) = 0                          -- weekly after it
  END;
$$;

-- ------------------------------------------------------------
-- 4. Dedup moves from MONTH to the actual send DATE (see header).
-- ------------------------------------------------------------
ALTER TABLE reminders_sent ADD COLUMN IF NOT EXISTS sent_on DATE;
UPDATE reminders_sent SET sent_on = sent_at::date WHERE sent_on IS NULL;
ALTER TABLE reminders_sent ALTER COLUMN sent_on SET DEFAULT CURRENT_DATE;

DROP INDEX IF EXISTS reminders_sent_once_idx;
CREATE UNIQUE INDEX IF NOT EXISTS reminders_sent_once_idx
  ON reminders_sent(unit_id, sent_on, party);

COMMENT ON COLUMN reminders_sent.sent_on IS
  'The send DATE. Dedup is per (unit, day, party): reminders now repeat daily inside a payment window, so a per-month key would swallow every send after the first.';

-- ------------------------------------------------------------
-- 5. Candidate queries, rebuilt on the window.
--    Both stay party-aware (0070) and service-only (0043).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_overdue_units();
CREATE FUNCTION get_overdue_units()
RETURNS TABLE (
  unit_id        UUID,
  unit_label     TEXT,
  building_id    UUID,
  building_name  TEXT,
  balance_usd    NUMERIC,
  period_end     DATE,
  due_date       DATE,
  is_overdue     BOOLEAN,
  owner_user_ids UUID[]
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Beirut')::date AS d),
  scoped AS (
    SELECT b.id AS bid, b.name, t.d, cy.notice_date, cy.due_date, cy.period_end
    FROM buildings b
    CROSS JOIN today t
    CROSS JOIN LATERAL reminder_cycle(b.id, t.d) cy
    WHERE b.is_active = true
      AND effective_billing_mode(b.id) = 'arrears'
      AND reminder_is_send_day(t.d, cy.notice_date, cy.due_date)
  )
  SELECT
    u.id, u.label, s.bid, s.name,
    -- as of the CLOSE of the period being settled, not today (see header)
    -unit_balance_asof(u.id, s.period_end) AS balance_usd,
    s.period_end, s.due_date, (s.d > s.due_date) AS is_overdue,
    COALESCE((
      SELECT ARRAY_AGG(DISTINCT m.user_id) FROM memberships m
      WHERE m.unit_id = u.id AND m.ended_at IS NULL AND m.tenure = 'owner'
    ), ARRAY[]::UUID[])
  FROM scoped s
  JOIN units u ON u.building_id = s.bid AND u.created_at::date <= s.period_end
  WHERE unit_balance_asof(u.id, s.period_end) < 0
    AND NOT EXISTS (
      SELECT 1 FROM reminders_sent rs
      WHERE rs.unit_id = u.id AND rs.sent_on = s.d AND rs.party = 'owner'
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
  amount_due     NUMERIC,
  party          TEXT,
  tenant_id      UUID,
  tenant_name    TEXT,
  is_overdue     BOOLEAN,
  owner_user_ids UUID[]
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Beirut')::date AS d),
  -- the window opens the day the dues were ISSUED and runs to their due date
  live AS (
    SELECT d.*, t.d AS today
    FROM dues d
    CROSS JOIN today t
    JOIN buildings b ON b.id = d.building_id AND b.is_active = true
    WHERE d.due_date IS NOT NULL
      AND effective_billing_mode(d.building_id) = 'dues'
      AND d.amount_due > 0
      AND reminder_is_send_day(t.d, d.created_at::date, d.due_date)
  ),
  latest AS (
    SELECT DISTINCT ON (l.unit_id, l.billed_to, l.tenant_id)
           l.unit_id, l.building_id, l.billed_to, l.tenant_id,
           l.period_label, l.due_date, l.created_at, l.today
    FROM live l
    ORDER BY l.unit_id, l.billed_to, l.tenant_id, l.due_date DESC, l.created_at DESC
  ),
  agg AS (
    SELECT a.*,
      (SELECT COALESCE(SUM(o.amount_due), 0) FROM live o
        WHERE o.unit_id = a.unit_id AND o.billed_to = a.billed_to
          AND o.tenant_id IS NOT DISTINCT FROM a.tenant_id
          AND o.period_label = a.period_label) AS billed,
      (SELECT COALESCE(SUM(p.amount_usd), 0) FROM payments p
        WHERE p.unit_id = a.unit_id AND p.voided_at IS NULL
          AND p.created_at >= a.created_at
          AND ((a.billed_to = 'tenant' AND p.paid_by = 'tenant'
                  AND (a.tenant_id IS NULL OR p.tenant_id = a.tenant_id))
            OR (a.billed_to <> 'tenant' AND p.paid_by IS DISTINCT FROM 'tenant'))) AS settled
    FROM latest a
  )
  SELECT
    a.unit_id, u.label, b.id, b.name, a.period_label, a.due_date,
    GREATEST(0, ROUND(a.billed - a.settled, 2)),
    a.billed_to, a.tenant_id,
    (SELECT pr.full_name FROM profiles pr WHERE pr.id = a.tenant_id),
    (a.today > a.due_date) AS is_overdue,
    COALESCE((
      SELECT ARRAY_AGG(DISTINCT m.user_id) FROM memberships m
      WHERE m.unit_id = a.unit_id AND m.ended_at IS NULL
        AND ((a.billed_to =  'tenant' AND m.tenure = 'tenant'
                AND (a.tenant_id IS NULL OR m.user_id = a.tenant_id))
          OR (a.billed_to <> 'tenant' AND m.tenure = 'owner'))
    ), ARRAY[]::UUID[])
  FROM agg a
  JOIN units u     ON u.id = a.unit_id
  JOIN buildings b ON b.id = a.building_id
  WHERE GREATEST(0, ROUND(a.billed - a.settled, 2)) > 0
    AND NOT EXISTS (
      SELECT 1 FROM reminders_sent rs
      WHERE rs.unit_id = a.unit_id AND rs.sent_on = a.today AND rs.party = a.billed_to
    );
$$;

-- ------------------------------------------------------------
-- 6. Writing the schedule needs `charge.manage`, NOT `building.manage` — so a
--    finance role can run collections without gaining the power to rename the
--    building. Sealed helper rather than a looser table policy (0047).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS set_reminder_schedule(UUID, TEXT, TEXT, INT, INT, INT, INT);
CREATE FUNCTION set_reminder_schedule(
  p_scope_type TEXT,              -- 'building' | 'compound'
  p_scope_id   UUID,
  p_frequency  TEXT,
  p_notice_day INT  DEFAULT NULL,
  p_weekday    INT  DEFAULT NULL,
  p_moq        INT  DEFAULT NULL,
  p_grace_days INT  DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_allowed BOOLEAN := FALSE;
BEGIN
  IF p_frequency NOT IN ('off','weekly','monthly','quarterly') THEN
    RAISE EXCEPTION 'Unknown reminder frequency %', p_frequency USING ERRCODE = '22023';
  END IF;

  IF p_scope_type = 'building' THEN
    v_allowed := is_platform_admin() OR user_can(p_scope_id, 'charge.manage');
  ELSIF p_scope_type = 'compound' THEN
    -- a compound is governed by whoever may manage charges on ANY of its blocks
    v_allowed := is_platform_admin() OR EXISTS (
      SELECT 1 FROM buildings b
      WHERE b.compound_id = p_scope_id AND user_can(b.id, 'charge.manage'));
  ELSE
    RAISE EXCEPTION 'Unknown scope %', p_scope_type USING ERRCODE = '22023';
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Not allowed to set the reminder schedule here.' USING ERRCODE = '42501';
  END IF;

  IF p_scope_type = 'building' THEN
    UPDATE buildings SET
      reminder_frequency = p_frequency,
      reminder_notice_day = p_notice_day,
      reminder_weekday = p_weekday,
      reminder_month_of_quarter = p_moq,
      reminder_grace_days = p_grace_days,
      -- keep the legacy column consistent so anything still reading it agrees
      reminder_day = CASE WHEN p_frequency = 'monthly' THEN p_notice_day ELSE NULL END
    WHERE id = p_scope_id;
  ELSE
    UPDATE compounds SET
      reminder_frequency = p_frequency,
      reminder_notice_day = p_notice_day,
      reminder_weekday = p_weekday,
      reminder_month_of_quarter = p_moq,
      reminder_grace_days = p_grace_days
    WHERE id = p_scope_id;
  END IF;
END;
$$;

REVOKE ALL     ON FUNCTION get_overdue_units() FROM PUBLIC, anon, authenticated;
REVOKE ALL     ON FUNCTION get_overdue_dues()  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_overdue_units() TO service_role;
GRANT  EXECUTE ON FUNCTION get_overdue_dues()  TO service_role;
GRANT  EXECUTE ON FUNCTION effective_reminder(UUID)     TO authenticated;
GRANT  EXECUTE ON FUNCTION reminder_cycle(UUID, DATE)   TO authenticated;
GRANT  EXECUTE ON FUNCTION set_reminder_schedule(TEXT, UUID, TEXT, INT, INT, INT, INT) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   SELECT * FROM reminder_cycle('<building>', CURRENT_DATE);
--     -> notice_date <= today, due_date = notice + grace, period_end = notice-1
--   SELECT reminder_is_send_day(DATE '2026-08-04', DATE '2026-08-01', DATE '2026-08-07'); -- true (in window)
--   SELECT reminder_is_send_day(DATE '2026-08-14', DATE '2026-08-01', DATE '2026-08-07'); -- true (weekly beat)
--   SELECT reminder_is_send_day(DATE '2026-08-13', DATE '2026-08-01', DATE '2026-08-07'); -- false
--   A building left on the old reminder_day keeps firing on exactly that day
--   (backfilled to monthly + grace 0).
-- ============================================================
