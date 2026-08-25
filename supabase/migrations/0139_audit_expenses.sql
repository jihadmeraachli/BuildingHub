-- ============================================================
-- 0139_audit_expenses.sql
-- Follow-up to 0137: the audit trail missed the `expenses` table entirely.
--
-- Creating an expense is a deliberate, low-volume, high-signal financial action
-- (a manager booking a cost) — exactly what the audit log should capture — but
-- 0137's table lists didn't include it. Add it to the FULL set (INSERT +
-- UPDATE + DELETE), reusing the existing audit_capture() trigger function.
--
-- (The derived `charges` rows an expense generates stay INSERT-excluded by
-- design — a dues run inserts hundreds at once; the expense record is the
-- signal, its allocation is noise. charges/payments still log UPDATE/DELETE.)
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

DROP TRIGGER IF EXISTS audit_trg ON expenses;
CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION audit_capture();

COMMIT;

-- Post-run check:
--   Create an expense in the app → a row appears in the Activity log:
--     "created expenses · <description>", with your name and time.
--   Edit its amount → an UPDATE row showing old → new amount_usd.
