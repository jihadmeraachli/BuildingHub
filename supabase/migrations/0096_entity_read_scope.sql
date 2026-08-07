-- ============================================================
-- 0096_entity_read_scope.sql
-- Buildings and compounds stop being world-readable (2026-08-06).
--
-- THE LEAK. `buildings_select_active` is v1 schema, and its own comment says
-- why it exists: "others can read active buildings (for registration)" — v1
-- made you pick your building from a list at signup. v3 does not: Register.tsx
-- never reads the table. What survived is a policy letting ANY authenticated
-- user list EVERY active building, and it is visible on screen — Buildings.tsx
-- and Compounds.tsx query unscoped and lean on RLS to filter, so a building
-- admin opening Configuration saw every building on the platform, other
-- customers' included.
--
-- COMPOUNDS ARE WORSE. 0002 created `compounds_select USING (auth.uid() IS NOT
-- NULL)`. 0022 added a properly scoped `compounds_read_scoped` — but never
-- dropped the old one, and permissive policies OR together, so 0022's scoping
-- has never had any effect. 0022 also allowed `org_id IS NULL`, which exposes
-- every standalone compound regardless.
--
-- THE RETURNING TRAP. Buildings.tsx creates a building with
-- `.insert(...).select('id')`, and RETURNING is subject to the SELECT policy.
-- The grant that would authorise it comes from `buildings_auto_grant_trg`,
-- an AFTER INSERT trigger (0031) — and Postgres projects RETURNING during the
-- insert while AFTER-row triggers are queued to the end of the statement. So a
-- grant-based read policy would reject the row the caller just created.
-- Making the trigger BEFORE does not work either: the grant references
-- buildings.id, so the row must exist first.
--
-- The fix is create_building(), a sealed SECURITY DEFINER function that
-- inserts, lets the trigger grant, and returns the id in one transaction —
-- the same pattern as set_lbp_rate (0086) and cancel_budget (0092). Creation
-- stays self-service (0031): any active user can still make a building and
-- become its admin.
--
-- Helpers are SECURITY DEFINER so the policies do not re-enter RLS on grants,
-- memberships and units and recurse — exactly why user_can() is built that way.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Who may SEE an entity: a grant that reaches it, or living in it.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS user_sees_building(UUID);
CREATE FUNCTION user_sees_building(p_building UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT is_platform_admin()
      OR EXISTS (
           SELECT 1 FROM grants g
           WHERE g.user_id = auth.uid()
             AND ( (g.scope_type = 'building' AND g.building_id = p_building)
                OR (g.scope_type = 'compound' AND g.compound_id =
                      (SELECT compound_id FROM buildings WHERE id = p_building))
                OR (g.scope_type = 'org' AND EXISTS (
                      SELECT 1 FROM org_buildings ob
                      WHERE ob.org_id = g.org_id AND ob.building_id = p_building)) ))
      OR EXISTS (
           SELECT 1 FROM memberships m
           JOIN units u ON u.id = m.unit_id
           WHERE u.building_id = p_building AND m.user_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION user_sees_building(UUID) TO authenticated;

DROP FUNCTION IF EXISTS user_sees_compound(UUID);
CREATE FUNCTION user_sees_compound(p_compound UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT is_platform_admin()
      OR EXISTS (
           SELECT 1 FROM grants g
           WHERE g.user_id = auth.uid()
             AND ( (g.scope_type = 'compound' AND g.compound_id = p_compound)
                OR (g.scope_type = 'org' AND g.org_id =
                      (SELECT org_id FROM compounds WHERE id = p_compound))
                OR (g.scope_type = 'building' AND EXISTS (
                      SELECT 1 FROM buildings b
                      WHERE b.id = g.building_id AND b.compound_id = p_compound)) ))
      OR EXISTS (
           SELECT 1 FROM memberships m
           JOIN units u     ON u.id = m.unit_id
           JOIN buildings b ON b.id = u.building_id
           WHERE b.compound_id = p_compound AND m.user_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION user_sees_compound(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 2. Replace the open read policies.
--    buildings_all_super_admin also goes: it keys on the legacy
--    profiles.role column that v3 stopped reading, and is_platform_admin()
--    already covers the operator.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "buildings_select_active"   ON buildings;
DROP POLICY IF EXISTS "buildings_all_super_admin" ON buildings;
DROP POLICY IF EXISTS "buildings_read_scoped"     ON buildings;
CREATE POLICY "buildings_read_scoped" ON buildings FOR SELECT TO authenticated
  USING (user_sees_building(id));

-- 0022 tried to scope this and was silently overridden by 0002's policy, which
-- was never dropped. Both go.
DROP POLICY IF EXISTS compounds_select        ON compounds;
DROP POLICY IF EXISTS "compounds_read_scoped" ON compounds;
CREATE POLICY "compounds_read_scoped" ON compounds FOR SELECT TO authenticated
  USING (user_sees_compound(id));

-- ------------------------------------------------------------
-- 3. Building creation, sealed — see THE RETURNING TRAP above.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS create_building(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID);
CREATE FUNCTION create_building(
  p_name          TEXT,
  p_address       TEXT DEFAULT NULL,
  p_city          TEXT DEFAULT NULL,
  p_country       TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL,
  p_contact_phone TEXT DEFAULT NULL,
  p_maps_url      TEXT DEFAULT NULL,
  p_compound_id   UUID DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id UUID;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'A building needs a name.' USING ERRCODE = '22023';
  END IF;

  -- Creation stays self-service (0031): any ACTIVE user may start a building
  -- and becomes its admin through the auto-grant trigger.
  IF NOT (is_platform_admin()
          OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status = 'active')) THEN
    RAISE EXCEPTION 'Not allowed to create a building.' USING ERRCODE = '42501';
  END IF;

  -- Putting a block INTO a compound is a different question from creating one:
  -- it must be a compound the caller actually manages, or anyone could attach
  -- a block to someone else's compound and inherit its cascade.
  IF p_compound_id IS NOT NULL AND NOT user_sees_compound(p_compound_id) THEN
    RAISE EXCEPTION 'Not allowed to add a block to that compound.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO buildings (name, address, city, country, contact_email, contact_phone, maps_url, compound_id, is_active)
  VALUES (btrim(p_name), p_address, p_city, p_country, p_contact_email, p_contact_phone, p_maps_url, p_compound_id, TRUE)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION create_building(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   As a building admin of ONE building: Configuration → Buildings shows that
--   building only. Before this it showed every building on the platform.
--   As a resident: their own building is still visible (statements, reports).
--   Create a building from the app → succeeds, and the creator is its admin.
--   As a platform admin: everything, unchanged.
--
--   The regression to watch: anything that read a building it has no grant or
--   membership on now gets an empty result instead of a row. Reports and
--   Finance resolve names from ids already in scope, so they are unaffected —
--   but this is the thing to look for if a name renders as blank.
-- ============================================================
