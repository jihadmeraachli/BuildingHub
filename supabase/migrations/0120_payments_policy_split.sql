-- ============================================================
-- 0120_payments_policy_split.sql
-- Finance audit finding H2: a collector can edit or delete any payment.
--
-- payments_write was FOR ALL on 'payment.record' — the cap 0110 gave the
-- collector role. 0110's own header says voiding stays with finance, but the
-- policy was never split, so a collector could UPDATE (change amount_usd) or
-- DELETE any payment in the building via the API, including ones they never
-- recorded — invisibly, since their own SELECT policy hides receipts that
-- aren't theirs.
--
-- Split: INSERT stays on 'payment.record' (collectors keep recording
-- receipts); UPDATE/DELETE move to 'payment.confirm' — a capability that
-- already exists on every admin/finance role bundle (permissions.ts) but was
-- never wired to anything until now, and is not held by building_collector.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

DROP POLICY IF EXISTS "payments_write" ON payments;

CREATE POLICY "payments_insert" ON payments FOR INSERT
  WITH CHECK (user_can(building_id, 'payment.record'));

CREATE POLICY "payments_update" ON payments FOR UPDATE
  USING (user_can(building_id, 'payment.confirm'))
  WITH CHECK (user_can(building_id, 'payment.confirm'));

CREATE POLICY "payments_delete" ON payments FOR DELETE
  USING (user_can(building_id, 'payment.confirm'));

COMMIT;

-- Post-run checks:
--   As a collector: insert a payment -> succeeds (unchanged).
--   As a collector: update/delete ANY payment (including their own) -> RLS denies.
--   As building_admin/finance: insert, update, delete all still work.
