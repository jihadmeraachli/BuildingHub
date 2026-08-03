-- ============================================================
-- 0076_payment_requests.sql
-- Payment reminders become obligation-driven instead of calendar-driven.
--
-- THE MODEL (Jihad + Ahmad):
--
--   ARREARS - there is no billing cycle. The admin asks for money whenever it
--     is needed ("Request payment"), which is also how a one-off big expense
--     gets settled. The request snapshots what each party owes RIGHT THEN and
--     gives them N days to pay.
--
--   DUES - already work exactly this way and need no new object: a dues row
--     carries an amount, a due date, a party and a tenant, and is settled by
--     payments made since it was issued. Generating dues IS the request, so it
--     is automatic with nothing for the admin to do.
--
--   ONE SETTING for both: payment_due_days (7 / 14 / 30 …), on the building and
--     cascading from the compound like billing_mode. It sets an arrears
--     request's due date and prefills the dues generator's.
--
--   REMINDERS, both types: DAILY until the due date, then WEEKLY (first one a
--     week after) until settled. Daily forever is harassment; stopping is the
--     opposite of a collections tool.
--
-- A REQUEST IS A SNAPSHOT, NOT A LIVE BALANCE. It says "you owed $500 on 1 Aug,
-- pay it by the 8th" and is settled once $500 has been paid SINCE it was
-- issued. Charges that land afterwards belong to the NEXT request - chasing
-- them under this one's due date moves the goalposts on someone who paid
-- exactly what was asked, on time. Partial payment keeps it open for the
-- remainder only.
--
-- ⚠️ DEPARTED TENANTS - the hole this migration closes. end_membership() (0065)
-- moves a leaving tenant's balance to the OWNER, but a tenant-tagged obligation
-- kept looking for that tenant: the recipient lookup requires an ACTIVE tenant
-- membership (so nobody was reminded) and settlement counted only that tenant's
-- payments (so the owner paying it never cleared it). The debt was chased
-- forever, by no one, silently. Now `effective_obligation_party()` resolves an
-- obligation whose tenant has left to the OWNER - for chasing AND for
-- settlement - while the row keeps its tenant_id for history. The rule across
-- the app: HISTORY KEEPS THE TENANT'S NAME, OPEN OBLIGATIONS FOLLOW THE MONEY.
--
-- ⚠️ DEDUP - reminders_sent was unique per (unit, MONTH, party) and
-- send-reminders treats a duplicate-key error as "already sent". Daily sending
-- would have fired once and gone silent for the rest of the month with no error
-- anywhere (the 0070 collision class). The key is now the send DATE.
--
-- WHO MAY SET IT: `charge.manage`, not `building.manage` - admins and finance
-- both hold it, collections is finance's job, the ناطور and viewers hold
-- neither. Written through SECURITY DEFINER RPCs rather than by loosening the
-- buildings UPDATE policy, which would also hand finance the name and address
-- (0047's sealed-helper discipline).
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. The one setting, on both levels (compound governs, like billing_mode).
-- ------------------------------------------------------------
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS payment_due_days INT;
ALTER TABLE compounds ADD COLUMN IF NOT EXISTS payment_due_days INT;

ALTER TABLE buildings DROP CONSTRAINT IF EXISTS buildings_due_days_chk;
ALTER TABLE buildings ADD  CONSTRAINT buildings_due_days_chk
  CHECK (payment_due_days IS NULL OR payment_due_days BETWEEN 1 AND 90);
ALTER TABLE compounds DROP CONSTRAINT IF EXISTS compounds_due_days_chk;
ALTER TABLE compounds ADD  CONSTRAINT compounds_due_days_chk
  CHECK (payment_due_days IS NULL OR payment_due_days BETWEEN 1 AND 90);

COMMENT ON COLUMN buildings.payment_due_days IS
  'Days residents get to pay. Sets an arrears request due date and prefills the dues generator. NULL = inherit the compound, then 7.';

DROP FUNCTION IF EXISTS effective_due_days(UUID);
CREATE FUNCTION effective_due_days(p_building UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(c.payment_due_days, b.payment_due_days, 7)
  FROM buildings b LEFT JOIN compounds c ON c.id = b.compound_id
  WHERE b.id = p_building;
$$;

-- ------------------------------------------------------------
-- 2. An obligation's EFFECTIVE party.
--    A tenant-tagged obligation whose tenant has moved out belongs to the
--    owner: end_membership() already moved the money there. The tag stays for
--    history; chasing and settlement follow the money.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS effective_obligation_party(UUID, TEXT, UUID);
CREATE FUNCTION effective_obligation_party(p_unit UUID, p_billed_to TEXT, p_tenant UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT CASE
    WHEN p_billed_to IS DISTINCT FROM 'tenant' THEN 'owner'
    -- still living there? it stays theirs
    WHEN EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.unit_id = p_unit AND m.tenure = 'tenant' AND m.ended_at IS NULL
        AND (p_tenant IS NULL OR m.user_id = p_tenant)
    ) THEN 'tenant'
    ELSE 'owner'          -- departed: offloaded to the owner (0065)
  END;
$$;

-- ------------------------------------------------------------
-- 3. Arrears payment requests. Dues need no equivalent - a dues row IS one.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id  UUID REFERENCES buildings(id) ON DELETE CASCADE,
  compound_id  UUID REFERENCES compounds(id) ON DELETE CASCADE,
  label        TEXT,                      -- e.g. "Roof repair settlement"
  requested_on DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date     DATE NOT NULL,
  created_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_request_scope CHECK ((building_id IS NOT NULL) OR (compound_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS payment_request_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  unit_id     UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  -- the party asked to pay. Reassigned to 'owner' if the tenant later leaves.
  party       TEXT NOT NULL DEFAULT 'owner' CHECK (party IN ('owner','tenant')),
  tenant_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  /** what that party owed AT ISSUE TIME — the whole point of a request */
  amount_requested NUMERIC(12,2) NOT NULL,
  /** set when a move-out moved this line to the owner; keeps the trail */
  offloaded_from_tenant_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prl_request_idx ON payment_request_lines(request_id);
CREATE INDEX IF NOT EXISTS prl_unit_idx    ON payment_request_lines(unit_id, party);
CREATE INDEX IF NOT EXISTS pr_due_idx      ON payment_requests(due_date);

ALTER TABLE payment_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_request_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pr_select ON payment_requests;
CREATE POLICY pr_select ON payment_requests FOR SELECT USING (
  is_platform_admin()
  OR (building_id IS NOT NULL AND user_can(building_id, 'finance.view'))
  OR (compound_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM buildings b WHERE b.compound_id = payment_requests.compound_id
          AND user_can(b.id, 'finance.view')))
);

-- A resident sees a request line for their own unit — it is a bill addressed
-- to them. Managers see their scope. Writes go through the RPCs only.
DROP POLICY IF EXISTS prl_select ON payment_request_lines;
CREATE POLICY prl_select ON payment_request_lines FOR SELECT USING (
  is_platform_admin()
  OR user_can(building_id, 'finance.view')
  OR EXISTS (SELECT 1 FROM memberships m
              WHERE m.unit_id = payment_request_lines.unit_id
                AND m.user_id = auth.uid() AND m.ended_at IS NULL)
);

-- ------------------------------------------------------------
-- 4. How much of a line is still owed.
--    Payments made by the line's EFFECTIVE party since the request went out.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS request_line_outstanding(UUID);
CREATE FUNCTION request_line_outstanding(p_line UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT GREATEST(0, ROUND(l.amount_requested - COALESCE((
    SELECT SUM(p.amount_usd) FROM payments p
    WHERE p.unit_id = l.unit_id AND p.voided_at IS NULL
      AND p.paid_on >= r.requested_on
      AND CASE WHEN l.party = 'tenant'
               THEN p.paid_by = 'tenant' AND (l.tenant_id IS NULL OR p.tenant_id = l.tenant_id)
               ELSE p.paid_by IS DISTINCT FROM 'tenant' END
  ), 0), 2))
  FROM payment_request_lines l
  JOIN payment_requests r ON r.id = l.request_id
  WHERE l.id = p_line;
$$;

-- ------------------------------------------------------------
-- 5. Issue a request. Snapshots every party currently in arrears.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS request_payment(TEXT, UUID, TEXT, INT);
CREATE FUNCTION request_payment(
  p_scope_type TEXT,               -- 'building' | 'compound'
  p_scope_id   UUID,
  p_label      TEXT DEFAULT NULL,
  p_due_days   INT  DEFAULT NULL   -- NULL = the entity's payment_due_days
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ids UUID[];
  v_req UUID;
  v_days INT;
BEGIN
  IF p_scope_type = 'building' THEN
    v_ids := ARRAY[p_scope_id];
  ELSIF p_scope_type = 'compound' THEN
    SELECT array_agg(id) INTO v_ids FROM buildings WHERE compound_id = p_scope_id;
  ELSE
    RAISE EXCEPTION 'Unknown scope %', p_scope_type USING ERRCODE = '22023';
  END IF;

  IF v_ids IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(v_ids) id
      WHERE is_platform_admin() OR user_can(id, 'charge.manage')) THEN
    RAISE EXCEPTION 'Not allowed to request payment here.' USING ERRCODE = '42501';
  END IF;

  v_days := COALESCE(p_due_days, effective_due_days(v_ids[1]));

  INSERT INTO payment_requests (building_id, compound_id, label, due_date, created_by)
  VALUES (
    CASE WHEN p_scope_type = 'building' THEN p_scope_id END,
    CASE WHEN p_scope_type = 'compound' THEN p_scope_id END,
    NULLIF(btrim(COALESCE(p_label, '')), ''),
    CURRENT_DATE + v_days,
    auth.uid())
  RETURNING id INTO v_req;

  -- One line per party actually in arrears. A leased unit can owe on both
  -- sides, and asking the owner to settle the tenant's arrears is the bug
  -- class 0070 removed everywhere else.
  INSERT INTO payment_request_lines (request_id, unit_id, building_id, party, tenant_id, amount_requested)
  SELECT v_req, u.id, u.building_id, pb.party,
         CASE WHEN pb.party = 'tenant' THEN (
           SELECT m.user_id FROM memberships m
           WHERE m.unit_id = u.id AND m.tenure = 'tenant' AND m.ended_at IS NULL
           ORDER BY m.created_at DESC LIMIT 1) END,
         pb.owed
  FROM units u
  CROSS JOIN LATERAL (
    -- unit_party_balance(unit, party) is signed: negative = owes (0064)
    SELECT 'owner'::TEXT AS party, ROUND(-unit_party_balance(u.id, 'owner'), 2) AS owed
    UNION ALL
    SELECT 'tenant',               ROUND(-unit_party_balance(u.id, 'tenant'), 2)
  ) pb
  WHERE u.building_id = ANY(v_ids) AND pb.owed > 0;

  RETURN v_req;
END;
$$;

DROP FUNCTION IF EXISTS set_payment_due_days(TEXT, UUID, INT);
CREATE FUNCTION set_payment_due_days(p_scope_type TEXT, p_scope_id UUID, p_days INT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_ok BOOLEAN := FALSE;
BEGIN
  IF p_days IS NOT NULL AND (p_days < 1 OR p_days > 90) THEN
    RAISE EXCEPTION 'Days to pay must be between 1 and 90.' USING ERRCODE = '22023';
  END IF;

  IF p_scope_type = 'building' THEN
    v_ok := is_platform_admin() OR user_can(p_scope_id, 'charge.manage');
    IF v_ok THEN UPDATE buildings SET payment_due_days = p_days WHERE id = p_scope_id; END IF;
  ELSIF p_scope_type = 'compound' THEN
    v_ok := is_platform_admin() OR EXISTS (
      SELECT 1 FROM buildings b WHERE b.compound_id = p_scope_id AND user_can(b.id, 'charge.manage'));
    IF v_ok THEN UPDATE compounds SET payment_due_days = p_days WHERE id = p_scope_id; END IF;
  ELSE
    RAISE EXCEPTION 'Unknown scope %', p_scope_type USING ERRCODE = '22023';
  END IF;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Not allowed to change the payment terms here.' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 6. Move-out reassigns OPEN request lines to the owner, matching where
--    end_membership() just moved the money. History (charges/payments/dues)
--    is never rewritten — only the open ask moves.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION offload_open_requests(p_unit UUID, p_tenant UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_n INT;
BEGIN
  UPDATE payment_request_lines l
     SET party = 'owner',
         offloaded_from_tenant_id = COALESCE(l.offloaded_from_tenant_id, l.tenant_id)
   WHERE l.unit_id = p_unit
     AND l.party = 'tenant'
     AND (p_tenant IS NULL OR l.tenant_id = p_tenant)
     AND l.cancelled_at IS NULL
     AND EXISTS (SELECT 1 FROM payment_requests r
                  WHERE r.id = l.request_id AND r.due_date >= CURRENT_DATE - 90);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- end_membership() gains the reassignment. Body is 0066's verbatim, with the
-- offload_open_requests() call added after the balance transfer — the open ask
-- must follow the money, or the debt is chased by nobody.
CREATE OR REPLACE FUNCTION end_membership(p_membership UUID)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_unit UUID; v_building UUID; v_tenure TEXT; v_user UUID;
  v_bal NUMERIC := 0; v_name TEXT;
BEGIN
  SELECT m.unit_id, u.building_id, m.tenure, m.user_id
    INTO v_unit, v_building, v_tenure, v_user
  FROM memberships m JOIN units u ON u.id = m.unit_id
  WHERE m.id = p_membership;

  IF v_unit IS NULL THEN RETURN 0; END IF;
  IF NOT (is_platform_admin() OR user_can(v_building, 'resident.manage')) THEN
    RAISE EXCEPTION 'Not allowed to end this membership.' USING ERRCODE = '42501';
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

    -- the money moved to the owner, so the open ask moves with it (0076)
    PERFORM offload_open_requests(v_unit, v_user);
  END IF;

  RETURN v_bal;
END;
$$;

-- ------------------------------------------------------------
-- 7. Reminder rhythm: daily to the due date, weekly after.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS reminder_is_send_day(DATE, DATE, DATE);
CREATE FUNCTION reminder_is_send_day(p_today DATE, p_from DATE, p_due DATE)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_today < p_from THEN FALSE
    WHEN p_today <= p_due THEN TRUE                 -- daily inside the window
    ELSE ((p_today - p_due) % 7) = 0                -- then weekly, first a week after
  END;
$$;

-- ------------------------------------------------------------
-- 8. Dedup moves from MONTH to the actual send DATE (see header).
-- ------------------------------------------------------------
ALTER TABLE reminders_sent ADD COLUMN IF NOT EXISTS sent_on DATE;
UPDATE reminders_sent SET sent_on = sent_at::date WHERE sent_on IS NULL;
ALTER TABLE reminders_sent ALTER COLUMN sent_on SET DEFAULT CURRENT_DATE;

DROP INDEX IF EXISTS reminders_sent_once_idx;
CREATE UNIQUE INDEX IF NOT EXISTS reminders_sent_once_idx
  ON reminders_sent(unit_id, sent_on, party);

COMMENT ON COLUMN reminders_sent.sent_on IS
  'Send DATE. Reminders repeat daily inside a payment window, so a per-month dedup key would swallow every send after the first.';

-- ------------------------------------------------------------
-- 9. Candidates. Arrears from open request lines; dues from the dues rows.
--    Both resolve a departed tenant's obligation to the owner.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS get_overdue_units();
CREATE FUNCTION get_overdue_units()
RETURNS TABLE (
  unit_id        UUID,
  unit_label     TEXT,
  building_id    UUID,
  building_name  TEXT,
  balance_usd    NUMERIC,
  request_label  TEXT,
  due_date       DATE,
  is_overdue     BOOLEAN,
  party          TEXT,
  owner_user_ids UUID[]
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Beirut')::date AS d),
  live AS (
    SELECT l.id, l.unit_id, l.building_id, l.tenant_id, r.label, r.due_date, t.d,
           effective_obligation_party(l.unit_id, l.party, l.tenant_id) AS eff_party,
           request_line_outstanding(l.id) AS owed
    FROM payment_request_lines l
    JOIN payment_requests r ON r.id = l.request_id
    JOIN buildings b        ON b.id = l.building_id AND b.is_active = true
    CROSS JOIN today t
    WHERE l.cancelled_at IS NULL
      AND effective_billing_mode(l.building_id) = 'arrears'
      AND reminder_is_send_day(t.d, r.requested_on, r.due_date)
  )
  SELECT
    v.unit_id, u.label, b.id, b.name, v.owed, v.label, v.due_date,
    (v.d > v.due_date) AS is_overdue, v.eff_party,
    COALESCE((
      SELECT ARRAY_AGG(DISTINCT m.user_id) FROM memberships m
      WHERE m.unit_id = v.unit_id AND m.ended_at IS NULL
        AND ((v.eff_party = 'tenant' AND m.tenure = 'tenant'
                AND (v.tenant_id IS NULL OR m.user_id = v.tenant_id))
          OR (v.eff_party = 'owner'  AND m.tenure = 'owner'))
    ), ARRAY[]::UUID[])
  FROM live v
  JOIN units u     ON u.id = v.unit_id
  JOIN buildings b ON b.id = v.building_id
  WHERE v.owed > 0
    AND NOT EXISTS (
      SELECT 1 FROM reminders_sent rs
      WHERE rs.unit_id = v.unit_id AND rs.sent_on = v.d AND rs.party = v.eff_party
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
  live AS (
    -- the window opens the day the dues were ISSUED and runs to their due date
    SELECT d.*, t.d AS today,
           effective_obligation_party(d.unit_id, d.billed_to, d.tenant_id) AS eff_party
    FROM dues d
    CROSS JOIN today t
    JOIN buildings b ON b.id = d.building_id AND b.is_active = true
    WHERE d.due_date IS NOT NULL
      AND effective_billing_mode(d.building_id) = 'dues'
      AND d.amount_due > 0
      AND reminder_is_send_day(t.d, d.created_at::date, d.due_date)
  ),
  latest AS (
    SELECT DISTINCT ON (l.unit_id, l.eff_party, l.tenant_id)
           l.unit_id, l.building_id, l.billed_to, l.eff_party, l.tenant_id,
           l.period_label, l.due_date, l.created_at, l.today
    FROM live l
    ORDER BY l.unit_id, l.eff_party, l.tenant_id, l.due_date DESC, l.created_at DESC
  ),
  agg AS (
    SELECT a.*,
      (SELECT COALESCE(SUM(o.amount_due), 0) FROM live o
        WHERE o.unit_id = a.unit_id AND o.eff_party = a.eff_party
          AND o.tenant_id IS NOT DISTINCT FROM a.tenant_id
          AND o.period_label = a.period_label) AS billed,
      -- settled by the EFFECTIVE party: after a move-out the owner's payment
      -- clears it, which the tenant-only test could never see
      (SELECT COALESCE(SUM(p.amount_usd), 0) FROM payments p
        WHERE p.unit_id = a.unit_id AND p.voided_at IS NULL
          AND p.created_at >= a.created_at
          AND CASE WHEN a.eff_party = 'tenant'
                   THEN p.paid_by = 'tenant' AND (a.tenant_id IS NULL OR p.tenant_id = a.tenant_id)
                   ELSE p.paid_by IS DISTINCT FROM 'tenant' END) AS settled
    FROM latest a
  )
  SELECT
    a.unit_id, u.label, b.id, b.name, a.period_label, a.due_date,
    GREATEST(0, ROUND(a.billed - a.settled, 2)),
    a.eff_party, a.tenant_id,
    (SELECT pr.full_name FROM profiles pr WHERE pr.id = a.tenant_id),
    (a.today > a.due_date) AS is_overdue,
    COALESCE((
      SELECT ARRAY_AGG(DISTINCT m.user_id) FROM memberships m
      WHERE m.unit_id = a.unit_id AND m.ended_at IS NULL
        AND ((a.eff_party = 'tenant' AND m.tenure = 'tenant'
                AND (a.tenant_id IS NULL OR m.user_id = a.tenant_id))
          OR (a.eff_party = 'owner'  AND m.tenure = 'owner'))
    ), ARRAY[]::UUID[])
  FROM agg a
  JOIN units u     ON u.id = a.unit_id
  JOIN buildings b ON b.id = a.building_id
  WHERE GREATEST(0, ROUND(a.billed - a.settled, 2)) > 0
    AND NOT EXISTS (
      SELECT 1 FROM reminders_sent rs
      WHERE rs.unit_id = a.unit_id AND rs.sent_on = a.today AND rs.party = a.eff_party
    );
$$;

REVOKE ALL     ON FUNCTION get_overdue_units() FROM PUBLIC, anon, authenticated;
REVOKE ALL     ON FUNCTION get_overdue_dues()  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_overdue_units() TO service_role;
GRANT  EXECUTE ON FUNCTION get_overdue_dues()  TO service_role;
GRANT  EXECUTE ON FUNCTION effective_due_days(UUID)                        TO authenticated;
GRANT  EXECUTE ON FUNCTION request_line_outstanding(UUID)                  TO authenticated;
GRANT  EXECUTE ON FUNCTION effective_obligation_party(UUID, TEXT, UUID)    TO authenticated;
GRANT  EXECUTE ON FUNCTION request_payment(TEXT, UUID, TEXT, INT)          TO authenticated;
GRANT  EXECUTE ON FUNCTION set_payment_due_days(TEXT, UUID, INT)           TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   SELECT request_payment('building','<id>','Roof repair', 14);
--     -> one line per party in arrears; none for a party that owes nothing
--   SELECT reminder_is_send_day(DATE '2026-08-04', DATE '2026-08-01', DATE '2026-08-08'); -- true
--   SELECT reminder_is_send_day(DATE '2026-08-15', DATE '2026-08-01', DATE '2026-08-08'); -- true (weekly)
--   SELECT reminder_is_send_day(DATE '2026-08-14', DATE '2026-08-01', DATE '2026-08-08'); -- false
--   Pay exactly the requested amount -> request_line_outstanding() = 0 even if
--   NEW charges landed after the request. That is the point.
--   End a tenancy -> offload_open_requests() moves the open line to the owner
--   and effective_obligation_party() reports 'owner' for their dues too.
-- ============================================================
