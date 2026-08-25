-- ============================================================
-- 0137_audit_log.sql
-- A central, append-only, tamper-evident audit trail.
--
-- WHY. Until now the only structured audit was subscription_events (billing).
-- Grant changes, deletions, and financial edits left no trace of WHO did them.
-- This adds one table, written by generic AFTER triggers, so nothing depends on
-- the client remembering to log. It reuses the same primitives as the rest of
-- the security model: auth.uid() and the JWT's aal claim (0133).
--
-- DESIGN.
--   · Append-only + tamper-evident: platform-admin SELECT only; NO update/
--     delete policy for anyone, so history cannot be rewritten from the app.
--     (A DB-superuser / SQL-Editor session can still alter it — true off-box
--     immutability is a later step; the nightly backup already keeps a copy.)
--   · Non-blocking: the trigger swallows its own errors (RAISE WARNING), so a
--     logging problem can NEVER stop a real business write. Trade-off: a rare
--     audit gap over an app outage — the right call for a young product.
--   · Volume-tuned: structural / privilege tables log INSERT+UPDATE+DELETE
--     (low volume, high value). Financial tables log only UPDATE+DELETE — the
--     risky mutations (edits, voids, removals); the initial ledger INSERT is
--     already the record and would be high-volume noise.
--   · profiles is scoped: only security-relevant column changes
--     (is_platform_admin / status / role), never language/notification toggles.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. The table.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id    UUID,                  -- auth.uid(): who (NULL = service_role / system)
  actor_aal   TEXT,                  -- 'aal1'/'aal2' from the JWT: how strongly authed
  action      TEXT NOT NULL,         -- INSERT | UPDATE | DELETE
  entity      TEXT NOT NULL,         -- table name
  entity_id   UUID,                  -- the affected row
  building_id UUID,                  -- for per-tenant filtering (best-effort from the row)
  old_row     JSONB,                 -- before  (UPDATE/DELETE) — the restore snapshot
  new_row     JSONB                  -- after   (INSERT/UPDATE)
);

CREATE INDEX IF NOT EXISTS audit_log_at_idx        ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx    ON audit_log (entity, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx     ON audit_log (actor_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_building_idx  ON audit_log (building_id, at DESC);

COMMENT ON TABLE audit_log IS
  'Append-only security audit trail (0137). Written by audit_capture() triggers. Platform-admin read only; no update/delete — tamper-evident within the app.';

-- ------------------------------------------------------------
-- 2. RLS: platform admin reads; nobody writes/edits through the API.
--    The trigger writes as SECURITY DEFINER (postgres), bypassing this.
-- ------------------------------------------------------------
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON audit_log FROM anon;
GRANT SELECT ON audit_log TO authenticated;      -- gated by the policy below
DROP POLICY IF EXISTS audit_log_read ON audit_log;
CREATE POLICY audit_log_read ON audit_log
  FOR SELECT TO authenticated
  USING (is_platform_admin());
-- deliberately NO insert/update/delete policy.

-- ------------------------------------------------------------
-- 3. The generic capture trigger.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_capture()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth AS $$
DECLARE
  v_new JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_old JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_eid UUID;
  v_bid UUID;
BEGIN
  -- profiles: only log security-relevant changes, not language/notify toggles.
  IF TG_TABLE_NAME = 'profiles' AND TG_OP = 'UPDATE'
     AND v_old->>'is_platform_admin' IS NOT DISTINCT FROM v_new->>'is_platform_admin'
     AND v_old->>'status'            IS NOT DISTINCT FROM v_new->>'status'
     AND v_old->>'role'              IS NOT DISTINCT FROM v_new->>'role' THEN
    RETURN NULL;
  END IF;

  v_eid := COALESCE(v_new->>'id', v_old->>'id')::UUID;
  v_bid := COALESCE(
             v_new->>'building_id', v_old->>'building_id',
             CASE WHEN TG_TABLE_NAME = 'buildings' THEN COALESCE(v_new->>'id', v_old->>'id') END
           )::UUID;

  INSERT INTO audit_log (actor_id, actor_aal, action, entity, entity_id, building_id, old_row, new_row)
  VALUES (auth.uid(), auth.jwt() ->> 'aal', TG_OP, TG_TABLE_NAME, v_eid, v_bid, v_old, v_new);

  RETURN NULL;  -- AFTER trigger
EXCEPTION WHEN OTHERS THEN
  -- Never let auditing break a real write.
  RAISE WARNING 'audit_capture failed on %.%: %', TG_TABLE_NAME, TG_OP, SQLERRM;
  RETURN NULL;
END;
$$;

-- ------------------------------------------------------------
-- 4. Attach triggers.
--    Full (INSERT+UPDATE+DELETE): privilege + structural + subscription.
--    Mutation-only (UPDATE+DELETE): financial ledgers (skip bulk inserts).
--    profiles: full, but filtered inside the function.
-- ------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'grants','memberships','membership_invites',
    'buildings','compounds','organizations','units','org_buildings',
    'subscriptions','profiles'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_trg ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER audit_trg AFTER INSERT OR UPDATE OR DELETE ON %I
           FOR EACH ROW EXECUTE FUNCTION audit_capture()', t);
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'charges','payments','adjustments','dues','invoices','budgets'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_trg ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER audit_trg AFTER UPDATE OR DELETE ON %I
           FOR EACH ROW EXECUTE FUNCTION audit_capture()', t);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Post-run checks (as platform admin, in the SQL Editor or app):
--   Change a grant / deactivate a user / delete a test building → a row appears:
--     SELECT at, actor_id, action, entity, entity_id FROM audit_log ORDER BY at DESC LIMIT 20;
--   Edit a payment amount → an UPDATE row with old_row.amount_usd vs new_row.amount_usd.
--   Toggle your notification language on profiles → NO row (filtered).
--   As a non-platform user: SELECT * FROM audit_log → empty (RLS), and there is
--     no way to INSERT/UPDATE/DELETE it through the API.
--
-- Next (app work, not this migration): a platform-admin "Activity" screen over
-- this table, a per-building view for org admins, and a daily high-risk digest.
