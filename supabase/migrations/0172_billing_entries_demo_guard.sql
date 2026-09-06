-- ============================================================
-- 0172_billing_entries_demo_guard.sql
-- QA sweep 2026-09-06: billing_entries missed 0171's enrollment (the repo
-- list said billing_notices/invoices; the live table is billing_entries,
-- and its RLS grants INSERT/UPDATE to expense.manage — which the demo
-- admin holds). One straggler, found by 0171's own coverage query.
-- Additive & idempotent.
-- ============================================================
DROP TRIGGER IF EXISTS deny_demo_write_trg ON billing_entries;
CREATE TRIGGER deny_demo_write_trg BEFORE INSERT OR UPDATE OR DELETE ON billing_entries
  FOR EACH ROW EXECUTE FUNCTION deny_demo_write();

-- Post-run: re-run 0171's coverage query — billing_entries must vanish from
-- the unguarded list.
