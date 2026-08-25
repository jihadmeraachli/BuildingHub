-- ============================================================
-- 0147_payment_due_link.sql
-- DUES audit D7 (Ahmad-approved): payments weren't tied to the dues they settle.
-- Reconciliation matched a party's payments over an open-ended window starting
-- at the earliest open due (0125/0140), which is correct for the common
-- true-up path but has two edge imprecisions:
--   · a credit paid BEFORE the earliest open due is excluded (over-chase);
--   · a later payment meant for something else is swept in (mis-apply).
--
-- FIX (additive, backward-compatible): a nullable payments.due_id. A payment
-- with due_id set is applied EXACTLY to that due, regardless of when it was
-- made — so a manager can direct a prepay (or a specific settlement) at the due
-- it belongs to and the window no longer matters. A payment with due_id NULL
-- (every existing payment, and any undirected new one) reconciles through the
-- SAME running-account window as before — so nothing about today's behavior
-- changes until someone opts in by directing a payment.
--
-- get_overdue_dues (latest 0140) is rebuilt to split `paid` into:
--   directed   = Σ payments whose due_id is one of this group's dues (exact), and
--   undirected = Σ party payments with due_id IS NULL in the window (as today).
-- A payment is in exactly one branch (due_id set or null), so no double count.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- 1. The link. ON DELETE SET NULL so voiding/removing a due never destroys the
--    payment record — the money stays on the unit as an (undirected) credit.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS due_id UUID REFERENCES dues(id) ON DELETE SET NULL;
COMMENT ON COLUMN payments.due_id IS
  'DUES mode (0147, D7): the specific due this payment settles. Set = applied exactly to that due regardless of timing; NULL = reconciled via the running-account window (every legacy payment).';
CREATE INDEX IF NOT EXISTS idx_payments_due_id ON payments(due_id) WHERE due_id IS NOT NULL;

-- 2. Reconcile against the link where present. Body is 0140's verbatim except
--    agg now carries the group's due ids, and settled.paid is the two-branch sum.
CREATE OR REPLACE FUNCTION get_overdue_dues()
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
    SELECT d.*, t.d AS today,
           effective_obligation_party(d.unit_id, d.billed_to, d.tenant_id) AS eff_party,
           CASE WHEN effective_obligation_party(d.unit_id, d.billed_to, d.tenant_id) = 'owner'
                THEN NULL ELSE d.tenant_id END AS grp_tenant
    FROM dues d
    CROSS JOIN today t
    JOIN buildings b ON b.id = d.building_id AND b.is_active = true AND b.deleted_at IS NULL
    WHERE d.due_date IS NOT NULL
      AND effective_billing_mode(d.building_id) = 'dues'
      AND d.amount_due > 0
      AND reminder_is_send_day(t.d, d.created_at::date, d.due_date)
      AND EXISTS (SELECT 1 FROM units u WHERE u.id = d.unit_id AND u.deleted_at IS NULL)
  ),
  agg AS (
    SELECT
      l.unit_id, l.building_id, l.eff_party, l.grp_tenant AS tenant_id, l.today,
      MIN(l.due_date)                       AS due_date,
      MIN(l.created_at)                     AS since,
      SUM(l.amount_due)                     AS billed,
      COUNT(*)                              AS periods,
      ARRAY_AGG(l.id)                       AS due_ids,   -- 0147 (D7)
      (ARRAY_AGG(l.period_label ORDER BY l.due_date))[1] AS period_label
    FROM live l
    GROUP BY l.unit_id, l.building_id, l.eff_party, l.grp_tenant, l.today
  ),
  settled AS (
    SELECT a.*,
      ( -- 0147 (D7) directed: a payment pinned to one of these dues settles it
        -- exactly, whenever it was made — the window no longer applies to it.
        COALESCE((SELECT SUM(p.amount_usd) FROM payments p
                   WHERE p.voided_at IS NULL AND p.due_id = ANY(a.due_ids)), 0)
        -- undirected: the running-account window, unchanged (0125/0140).
      + COALESCE((SELECT SUM(p.amount_usd) FROM payments p
                   WHERE p.unit_id = a.unit_id AND p.voided_at IS NULL AND p.due_id IS NULL
                     AND p.created_at >= a.since
                     AND CASE WHEN a.eff_party = 'tenant'
                              THEN p.paid_by = 'tenant' AND (a.tenant_id IS NULL OR p.tenant_id = a.tenant_id)
                              ELSE p.paid_by IS DISTINCT FROM 'tenant' END), 0)
      ) AS paid
    FROM agg a
  )
  SELECT
    s.unit_id, u.label, b.id, b.name,
    CASE WHEN s.periods > 1 THEN s.period_label || ' +' || (s.periods - 1) ELSE s.period_label END,
    s.due_date,
    GREATEST(0, ROUND(s.billed - s.paid, 2)),
    s.eff_party, s.tenant_id,
    (SELECT pr.full_name FROM profiles pr WHERE pr.id = s.tenant_id),
    (s.today > s.due_date) AS is_overdue,
    recips.ids
  FROM settled s
  JOIN units u     ON u.id = s.unit_id     AND u.deleted_at IS NULL
  JOIN buildings b ON b.id = s.building_id AND b.deleted_at IS NULL
  CROSS JOIN LATERAL (
    SELECT COALESCE(ARRAY_AGG(DISTINCT m.user_id), ARRAY[]::UUID[]) AS ids
    FROM memberships m
    WHERE m.unit_id = s.unit_id AND m.ended_at IS NULL
      AND ((s.eff_party = 'tenant' AND m.tenure = 'tenant'
              AND (s.tenant_id IS NULL OR m.user_id = s.tenant_id))
        OR (s.eff_party = 'owner'  AND m.tenure = 'owner'))
  ) recips
  WHERE GREATEST(0, ROUND(s.billed - s.paid, 2)) > 0
    AND cardinality(recips.ids) > 0
    AND NOT EXISTS (
      SELECT 1 FROM reminders_sent rs
      WHERE rs.unit_id = s.unit_id AND rs.sent_on = s.today
        AND rs.party = s.eff_party AND rs.source = 'dues'
    )
  ORDER BY b.name, u.label, s.eff_party;
$$;

COMMIT;

-- Post-run checks:
--   Legacy (all payments due_id NULL) → identical numbers to 0140.
--   Direct a $50 prepay at a $100 due (payments.due_id = that due) → the cron
--     chases $50 even though the payment predates the due's window.
--   Direct a payment at a due in another (already-paid) period → it does NOT
--     reduce this period's chase (it's pinned elsewhere), and isn't double-counted.
