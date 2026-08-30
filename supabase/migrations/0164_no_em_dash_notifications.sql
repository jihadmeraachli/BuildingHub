-- ============================================================
-- 0164_no_em_dash_notifications.sql
-- House style (30 Aug): no em dashes in user-facing notification text.
--
-- Every in-app bell string lives inside SQL functions (triggers + RPCs that
-- INSERT INTO notifications). Instead of restating each function verbatim -
-- fourteen migrations' worth, and a drift risk on every future edit - this
-- rewrites the LIVE definitions in place: for each public function whose
-- body writes notifications (plus my_membership_invites, whose returned
-- placeholder is user-visible), take pg_get_functiondef(), swap the em
-- dashes for plain hyphens, and EXECUTE the result. CREATE OR REPLACE
-- keeps the OID, so trigger bindings are untouched.
--
-- Bonus: RAISE messages inside those same functions lose their em dashes
-- too. Functions without one are skipped. Idempotent by nature: a second
-- run finds nothing to replace.
-- ============================================================
BEGIN;

DO $do$
DECLARE
  r RECORD;
  v_def TEXT;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF position('—' IN v_def) > 0
       AND (position('INSERT INTO notifications' IN v_def) > 0
            OR r.proname = 'my_membership_invites') THEN
      v_def := replace(v_def, ' — ', ' - ');
      v_def := replace(v_def, '—', '-');
      EXECUTE v_def;
      v_count := v_count + 1;
      RAISE NOTICE 'de-dashed: %', r.proname;
    END IF;
  END LOOP;
  RAISE NOTICE 'functions rewritten: %', v_count;
END $do$;

COMMIT;

-- Post-run checks:
--   1. The NOTICE list names the rewritten functions (notify_on_charge,
--      notify_on_payment, dues/payment-request/invite/lost-item/poll
--      notifiers, contribution + expense void RPCs, ...). Re-run -> 0.
--   2. Record a payment: the bell says "$X received - thank you".
