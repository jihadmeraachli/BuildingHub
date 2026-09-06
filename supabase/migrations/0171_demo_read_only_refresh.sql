-- ============================================================
-- 0171_demo_read_only_refresh.sql
-- Close the demo write holes (Jey, 2026-09-06): the demo admin closed a poll.
--
-- WHY. 0094 made the public demo read-only with BEFORE triggers on an
-- explicit table list — and that list froze on 2026-08-06. Every table born
-- since (voting 0155/0156, lost & found, amenities, projects, inspection
-- categories, meter settings, funds, special charges, documents, payment
-- intents…) shipped WITHOUT the trigger, so the demo personas' real
-- building_admin grant could write to all of them. Triggers fire under
-- SECURITY DEFINER RPCs too, so enrolling the tables closes the RPC doors
-- (close_poll, cast_vote, …) as well.
--
-- THE RULE THIS RESTATES (also added to CLAUDE.md): every migration that
-- CREATEs a user-writable table MUST attach deny_demo_write_trg to it.
-- This migration re-runs the loop over the FULL current list — the union of
-- 0094's tables and everything since — and is the single reference list.
--
-- Deliberately NOT blocked:
--   · notifications, device_tokens, profiles — 0094's original allowances
--     (bell reads, push, language switch under the column guard);
--   · feedback, waitlist — a prospect writing to us FROM the demo is a lead,
--     not vandalism;
--   · audit_log, grant_history, subscription_events, reminders_sent — system
--     side-effect tables: blocking them could make an ALLOWED demo action
--     fail through a cascade trigger, and direct writes are already denied
--     by their RLS.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- 0094's original list
    'buildings','compounds','organizations','org_buildings','units','groups','unit_groups',
    'grants','memberships','membership_invites',
    'expenses','expense_types','charges','payments','adjustments',
    'dues','dues_plans','dues_unit_amounts','budgets','budget_lines',
    'payment_requests','payment_request_lines',
    'meter_cycles','meter_readings',
    'issues','meetings','meeting_issues','inspections','service_contracts','building_contacts',
    'subscriptions','license_assignments','import_batches',
    -- born after 0094, previously unprotected
    'polls','poll_options','poll_votes','poll_defaults',
    'lost_items','amenities','projects','inspection_categories',
    'meter_settings','funds','fund_entries','special_charges',
    'building_documents','payment_intents','invoices','billing_notices'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS deny_demo_write_trg ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER deny_demo_write_trg BEFORE INSERT OR UPDATE OR DELETE ON %I
           FOR EACH ROW EXECUTE FUNCTION deny_demo_write()', t);
    ELSE
      RAISE NOTICE 'skipped % (does not exist)', t;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- ============================================================
-- Post-run checks (as the demo ADMIN persona at /demo?as=admin):
--   1. Voting → Close now on the open poll → refused with the read-only
--      message (the bug that triggered this migration).
--   2. Voting → create a vote → refused.
--   3. Lost & found → report an item → refused.
--   4. Amenities / Projects / Inspections → any save → refused.
--   As the demo OWNER persona:
--   5. Voting → cast a vote → refused (the seeded 6-3 result stays intact
--      for the next visitor).
--   6. Marking the notification bell read still works (not blocked).
-- Coverage query — any user-writable public table missing the trigger:
--   SELECT c.relname FROM pg_class c
--    JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'r'
--     AND NOT EXISTS (SELECT 1 FROM pg_trigger g
--                      WHERE g.tgrelid = c.oid AND g.tgname = 'deny_demo_write_trg')
--   ORDER BY 1;
--   Expect ONLY: notifications, device_tokens, profiles, beta_access_codes,
--   waitlist, feedback, audit_log, grant_history, subscription_events,
--   reminders_sent (each deliberately open — see header).
-- ============================================================
