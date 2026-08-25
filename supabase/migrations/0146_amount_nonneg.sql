-- ============================================================
-- 0146_amount_nonneg.sql
-- Finance audit F3 (defense-in-depth): nothing stopped a negative amount_usd
-- from being written to the money ledgers. A negative charge or payment flips
-- the sign of a balance silently — a data-entry slip or a malformed RPC payload
-- becomes a wrong balance with no error. Add a non-negative CHECK on both.
--
-- Added NOT VALID: the constraint is enforced on every INSERT/UPDATE from now
-- on, but existing rows are not re-scanned (so this can never fail to apply on
-- live data). If a later audit confirms no negative rows exist, it can be
-- promoted with: ALTER TABLE charges VALIDATE CONSTRAINT charges_amount_nonneg;
--
-- This also hardens repost_expense and every other charge/payment writer: a
-- negative slips through to a constraint violation instead of a bad balance.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'charges_amount_nonneg') THEN
    ALTER TABLE charges  ADD CONSTRAINT charges_amount_nonneg  CHECK (amount_usd >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_amount_nonneg') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_amount_nonneg CHECK (amount_usd >= 0) NOT VALID;
  END IF;
END $$;

COMMIT;

-- Post-run checks:
--   INSERT a charge/payment with amount_usd = -5 → rejected (check violation).
--   Existing rows untouched; normal positive writes unaffected.
--   Optional later: VALIDATE CONSTRAINT once negatives are confirmed absent.
