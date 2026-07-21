-- ============================================================
-- 0033_opening_balance.sql
-- Opening balances + balance-as-of-a-date.
--
-- Problem: unit_balance was SUM(payments) − SUM(charges), all-time. When a
-- building joins Abniyah, unit 4B already owes from before — there was nowhere
-- to put that except a fake back-dated charge (which pollutes the P&L). And
-- every balance was "right now", so you could never produce a statement
-- "as of 31 Dec".
--
-- Fix:
--   1. units.opening_balance      — the unit's balance when it joined the system.
--                                   SIGN MATCHES balance: + = starts in credit,
--                                   − = starts owing. Not a charge/payment, so it
--                                   never appears in the P&L (collected/spent).
--   2. units.opening_balance_date — the "as of" anchor for that figure.
--   3. unit_balance() now folds in the opening balance.
--   4. unit_balance_asof(unit, date) — balance at a point in time.
--   5. building_book_asof(building, date) — per-unit book at a point in time
--      (for statements / the Finance "as of" view).
--
-- Additive & idempotent. Transactional.
-- ============================================================
BEGIN;

ALTER TABLE units ADD COLUMN IF NOT EXISTS opening_balance      NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE units ADD COLUMN IF NOT EXISTS opening_balance_date DATE;

COMMENT ON COLUMN units.opening_balance IS
  'Balance carried in when the unit joined the system. Signed like unit_balance: + = credit, − = owes. Excluded from P&L.';
COMMENT ON COLUMN units.opening_balance_date IS
  'The date units.opening_balance is stated as-of. Transactions are expected on/after this date.';

-- ------------------------------------------------------------
-- Current balance = opening + payments − charges.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION unit_balance(p_unit UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT ROUND(
      COALESCE((SELECT opening_balance FROM units WHERE id = p_unit), 0)
    + COALESCE((SELECT SUM(amount_usd) FROM payments WHERE unit_id = p_unit), 0)
    - COALESCE((SELECT SUM(amount_usd) FROM charges  WHERE unit_id = p_unit), 0)
  , 2);
$$;

-- ------------------------------------------------------------
-- Balance as of a date: opening counts only if its as-of date has arrived,
-- and only transactions dated on/before p_asof are included.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION unit_balance_asof(p_unit UUID, p_asof DATE)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT ROUND(
      COALESCE((SELECT opening_balance FROM units
                 WHERE id = p_unit
                   AND (opening_balance_date IS NULL OR opening_balance_date <= p_asof)), 0)
    + COALESCE((SELECT SUM(amount_usd) FROM payments WHERE unit_id = p_unit AND paid_on     <= p_asof), 0)
    - COALESCE((SELECT SUM(amount_usd) FROM charges  WHERE unit_id = p_unit AND charge_date <= p_asof), 0)
  , 2);
$$;

-- ------------------------------------------------------------
-- Per-unit book for a whole building at a point in time (statements / reports).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION building_book_asof(p_building UUID, p_asof DATE)
RETURNS TABLE(unit_id UUID, label TEXT, balance NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id, u.label, unit_balance_asof(u.id, p_asof)
  FROM units u
  WHERE u.building_id = p_building
  ORDER BY u.label;
$$;

GRANT EXECUTE ON FUNCTION unit_balance_asof(UUID, DATE)     TO authenticated;
GRANT EXECUTE ON FUNCTION building_book_asof(UUID, DATE)    TO authenticated;

COMMIT;

-- ------------------------------------------------------------
-- Post-run checks (read-only):
--   -- opening balance now moves the number:
--   --   pick a unit, note unit_balance(id), set opening_balance, re-check.
--   SELECT id, label, opening_balance, opening_balance_date, unit_balance(id) AS now
--   FROM units ORDER BY label LIMIT 10;
--
--   -- a unit's balance at year-end:
--   SELECT unit_balance_asof('<unit-uuid>', DATE '2026-12-31');
-- ------------------------------------------------------------
