-- ============================================================
-- 0115_subscription_read_scope.sql
-- Two fixes found by driving 0114 as the demo accounts.
--
-- 1. READ GAP (pre-existing since 0031, surfaced now). The subscriptions and
--    invoices read policies' compound/org branches admit only compound- or
--    org-SCOPED grants. A building admin whose block lives under a
--    compound-scoped subscription could not read the subscription row or its
--    invoices at all — their Billing page was empty while
--    get_building_subscription (SECURITY DEFINER) happily resolved it.
--    Fix: the compound branch also admits anyone with finance.view on any
--    block of that compound, and the org branch likewise via org_buildings.
--    MANAGING (subscribe/cancel/auto-renew) is unchanged: that stays with the
--    compound/org admin, deliberately — a block admin can look, not spend.
--
-- 2. THE PUBLIC DEMO. Tulip's compound subscription was a real 30-day trial
--    ending 2026-08-24: the next morning cron would have moved the public
--    demo into grace and, a week later, locked it read-only. The demo is a
--    showroom, not a customer — pin its trial far in the future (the same
--    2099 convention 0041 documents for operator-managed rows).
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

DROP POLICY IF EXISTS "subscriptions_read_scope_admin" ON subscriptions;
CREATE POLICY "subscriptions_read_scope_admin" ON subscriptions FOR SELECT TO authenticated USING (
  (scope_type = 'building' AND user_can_unlocked(building_id, 'finance.view'))
  OR (scope_type = 'compound' AND (
        EXISTS (SELECT 1 FROM grants g WHERE g.user_id = auth.uid() AND g.scope_type = 'compound' AND g.compound_id = subscriptions.compound_id)
        OR EXISTS (SELECT 1 FROM buildings b WHERE b.compound_id = subscriptions.compound_id AND user_can_unlocked(b.id, 'finance.view'))))
  OR (scope_type = 'org' AND (
        EXISTS (SELECT 1 FROM grants g WHERE g.user_id = auth.uid() AND g.scope_type = 'org' AND g.org_id = subscriptions.org_id)
        OR EXISTS (SELECT 1 FROM org_buildings ob WHERE ob.org_id = subscriptions.org_id AND user_can_unlocked(ob.building_id, 'finance.view'))))
);

DROP POLICY IF EXISTS "invoices_read_scope_admin" ON invoices;
CREATE POLICY "invoices_read_scope_admin" ON invoices FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM subscriptions s WHERE s.id = invoices.subscription_id AND (
       (s.scope_type = 'building' AND user_can_unlocked(s.building_id, 'finance.view'))
    OR (s.scope_type = 'compound' AND (
          EXISTS (SELECT 1 FROM grants g WHERE g.user_id = auth.uid() AND g.scope_type = 'compound' AND g.compound_id = s.compound_id)
          OR EXISTS (SELECT 1 FROM buildings b WHERE b.compound_id = s.compound_id AND user_can_unlocked(b.id, 'finance.view'))))
    OR (s.scope_type = 'org' AND (
          EXISTS (SELECT 1 FROM grants g WHERE g.user_id = auth.uid() AND g.scope_type = 'org' AND g.org_id = s.org_id)
          OR EXISTS (SELECT 1 FROM org_buildings ob WHERE ob.org_id = s.org_id AND user_can_unlocked(ob.building_id, 'finance.view'))))))
);

-- the public demo never lapses
UPDATE subscriptions SET trial_ends_at = '2099-01-01'
 WHERE id = 'f0c8118c-89c3-477f-8460-4d69f9d705f6' AND status = 'trial';

COMMIT;

-- Post-run checks:
--   As the demo admin (building-scoped grant, compound-scoped subscription):
--     supabase.from('subscriptions').select('*') → 1 row (was 0)
--     supabase.from('invoices').select('*')      → its invoices
--   Demo subscription trial_ends_at = 2099-01-01; tomorrow's cron leaves it alone.
--   As the demo owner (resident): subscriptions → 0 rows, unchanged.
