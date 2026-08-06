-- ============================================================
-- 0095_audit_fk_set_null.sql
-- Finish what 0026 started: audit references release when a person is deleted
-- (2026-08-06).
--
-- 0026's principle was "deactivate, don't delete", and where a delete IS
-- allowed the audit trail should survive it — so the FKs recording WHO did
-- something were converted to ON DELETE SET NULL. The sweep missed some.
-- `subscriptions.created_by` is still plain NO ACTION, and it surfaced during
-- the database reset as:
--
--   ERROR 23503: update or delete on table "profiles" violates foreign key
--   constraint "subscriptions_created_by_fkey" on table "subscriptions"
--
-- That is not just a reset inconvenience. delete_user() (0026, platform-admin
-- only) hits the identical wall, so the app's own supported way to remove a
-- person fails with a raw Postgres error the UI cannot explain.
--
-- Rather than name the columns one by one and miss the next one, this walks the
-- catalog: every single-column, NULLABLE foreign key pointing at profiles or
-- auth.users with NO ACTION / RESTRICT becomes ON DELETE SET NULL.
--
-- NOT NULL columns are deliberately left alone and reported instead — those
-- rows must be DELETED with the person, not orphaned, and that is a decision
-- per table rather than something a sweep should guess at. (profiles.id →
-- auth.users is one of these, and must stay CASCADE.)
--
-- Additive & idempotent — re-running finds nothing left to change.
-- ============================================================
BEGIN;

DO $$
DECLARE
  r RECORD;
  v_target TEXT;
  v_changed INT := 0;
  v_skipped INT := 0;
BEGIN
  FOR r IN
    SELECT c.oid, c.conname, c.conrelid::regclass AS tbl, c.confrelid::regclass AS ref,
           a.attname AS col, a.attnotnull AS notnull
    FROM pg_constraint c
    JOIN unnest(c.conkey) AS k(attnum) ON TRUE
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'f'
      AND c.confrelid IN ('public.profiles'::regclass, 'auth.users'::regclass)
      AND c.confdeltype IN ('a', 'r')            -- NO ACTION / RESTRICT
      AND array_length(c.conkey, 1) = 1          -- single-column only
  LOOP
    IF r.notnull THEN
      RAISE NOTICE 'LEFT ALONE (NOT NULL): %.% → % [%]', r.tbl, r.col, r.ref, r.conname;
      v_skipped := v_skipped + 1;
    ELSE
      v_target := r.ref::TEXT;
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
      EXECUTE format(
        'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s(id) ON DELETE SET NULL',
        r.tbl, r.conname, r.col, v_target);
      RAISE NOTICE 'SET NULL: %.% → %', r.tbl, r.col, r.ref;
      v_changed := v_changed + 1;
    END IF;
  END LOOP;
  RAISE NOTICE '% constraint(s) converted, % left alone', v_changed, v_skipped;
END $$;

COMMIT;

-- ============================================================
-- Post-run checks:
--   Re-running this migration reports "0 constraint(s) converted".
--
--   Any constraint reported as LEFT ALONE (NOT NULL) needs a per-table
--   decision: either the row is deleted with the person, or the column becomes
--   nullable. profiles.id → auth.users appears here and must STAY as it is.
--
--   The real test: delete_user() on an account that created a subscription now
--   succeeds, and the subscription keeps its history with created_by NULL.
-- ============================================================
