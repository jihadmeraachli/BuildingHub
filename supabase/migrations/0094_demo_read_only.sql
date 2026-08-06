-- ============================================================
-- 0094_demo_read_only.sql
-- The public demo becomes read-only IN THE DATABASE (2026-08-06).
--
-- WHY. The demo password is public by design — it ships in the bundle
-- (src/lib/demo.ts) so the "See the live demo" button works with no signup.
-- Until now the only thing stopping a visitor from writing to the showcase was
-- client-side gating, which demo.ts admits is best-effort: "worst case a stray
-- API write lands in the demo". Anyone who reads the JS can call the API
-- directly.
--
-- That forced a bad trade: the demo admin persona was given `viewer`
-- (finance.view + issue.view_all) to keep it harmless, which also hid People,
-- invitations and every management surface — the parts of the product a
-- prospect most needs to see.
--
-- With writes refused by the database, the grant can be a real building_admin
-- and the demo can show everything, safely. Same move as 0092 made for the
-- metered-expense guard: the rule belongs in SQL, not the client.
--
-- HOW. profiles.is_demo marks the persona accounts, and a BEFORE trigger on
-- each showcase table rejects any write while a demo account is the caller.
-- Marking it as DATA (not a hardcoded email list) means adding a third persona
-- later is an UPDATE, not a migration.
--
-- Deliberately NOT blocked, so the demo still behaves like an app:
--   · notifications      — marking the bell read
--   · device_tokens      — push registration
--   · profiles           — but only the harmless columns; see the guard below,
--                          which still refuses renames so the showcase cannot
--                          be defaced for every other visitor
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN profiles.is_demo IS
  'Public demo persona (src/lib/demo.ts). Every write is refused by the deny_demo_write triggers.';

UPDATE profiles p SET is_demo = TRUE
FROM auth.users u
WHERE u.id = p.id
  AND lower(u.email) IN ('jihad.meraachli+demoviewer@gmail.com',
                         'jihad.meraachli+demoowner@gmail.com');

-- STABLE + SECURITY DEFINER: called once per statement per table, and must see
-- profiles regardless of the caller's own RLS.
DROP FUNCTION IF EXISTS is_demo_user();
CREATE FUNCTION is_demo_user() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE((SELECT is_demo FROM profiles WHERE id = auth.uid()), FALSE);
$$;
GRANT EXECUTE ON FUNCTION is_demo_user() TO authenticated;

CREATE OR REPLACE FUNCTION deny_demo_write() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF is_demo_user() THEN
    RAISE EXCEPTION 'This is a read-only demo. Start a free trial to make changes.'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END; $$;

-- Attach to every showcase table. A loop rather than 25 hand-written triggers,
-- so the list stays readable and a table added later is one line.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'buildings','compounds','organizations','org_buildings','units','groups','unit_groups',
    'grants','memberships','membership_invites',
    'expenses','expense_types','charges','payments','adjustments',
    'dues','dues_plans','dues_unit_amounts','budgets','budget_lines',
    'payment_requests','payment_request_lines',
    'meter_cycles','meter_readings',
    'issues','meetings','meeting_issues','inspections','service_contracts','building_contacts',
    'subscriptions','license_assignments','import_batches'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS deny_demo_write_trg ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER deny_demo_write_trg BEFORE INSERT OR UPDATE OR DELETE ON %I
           FOR EACH ROW EXECUTE FUNCTION deny_demo_write()', t);
    END IF;
  END LOOP;
END $$;

-- profiles is special: a demo visitor may switch language or notification
-- channels (both are part of what the demo shows off), but must not rename the
-- persona — that would deface the showcase for everyone who visits after them.
CREATE OR REPLACE FUNCTION deny_demo_profile_edit() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF is_demo_user() AND (
       NEW.full_name        IS DISTINCT FROM OLD.full_name
    OR NEW.phone            IS DISTINCT FROM OLD.phone
    OR NEW.avatar_url       IS DISTINCT FROM OLD.avatar_url
    OR NEW.apartment_number IS DISTINCT FROM OLD.apartment_number
    OR NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin
    OR NEW.is_demo          IS DISTINCT FROM OLD.is_demo) THEN
    RAISE EXCEPTION 'This is a read-only demo. Start a free trial to make changes.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS deny_demo_profile_edit_trg ON profiles;
CREATE TRIGGER deny_demo_profile_edit_trg BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION deny_demo_profile_edit();

-- ------------------------------------------------------------
-- Now the grant can be the real thing: the demo admin persona shows People,
-- invitations and every management surface, with writes refused above.
-- ------------------------------------------------------------
UPDATE grants g SET role = 'building_admin'
FROM auth.users u
WHERE u.id = g.user_id
  AND lower(u.email) = 'jihad.meraachli+demoviewer@gmail.com'
  AND g.role = 'viewer';

COMMIT;

-- ============================================================
-- Post-run checks:
--   Sign in at /demo as the ADMIN persona → People appears, the building is
--   fully visible, and any save is refused with the read-only message.
--   Sign in as the OWNER persona → their units, balance and statement as
--   before; marking a notification read still works.
--   Seeding still works: seed-demo.mjs runs as a normal admin, not a demo
--   account, so nothing here touches it.
--
-- Adding a third persona later:
--   UPDATE profiles SET is_demo = TRUE WHERE id = '<user-id>';
-- ============================================================
