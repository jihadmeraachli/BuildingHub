-- ============================================================
-- 0131_fix_block_injection.sql
-- SECURITY FIX (audit H1, HIGH): any active user could attach a building to
-- another tenant's compound (or a compound to another tenant's org) and, via
-- the auto-grant trigger, become its admin.
--
-- THE HOLE. buildings_insert_self_service (0047) is
--   WITH CHECK (is_platform_admin() OR is_active_profile())
-- and never inspects compound_id. A self-registered active user could
-- INSERT INTO buildings with any compound_id straight through PostgREST; the
-- AFTER INSERT auto_grant_on_entity_create trigger (0031) then handed them a
-- building_admin grant on that block, now living inside the victim's compound
-- (whose finances derive from its blocks' charges). create_building() tried to
-- guard this but (a) the direct INSERT bypasses the RPC, and (b) it used
-- user_sees_compound — a READ/visibility check that is true for a mere
-- resident. Same shape on compounds_insert_self_service (arbitrary org_id).
--
-- THE FIX.
--   1. A new helper user_manages_compound() — the MANAGE analogue of
--      user_sees_compound: true only for platform admin, or a grant (compound,
--      org via compounds.org_id, or a block of the compound) carrying
--      building.manage. Residency/memberships do NOT count.
--   2. buildings_insert_self_service now requires: no compound (plain
--      self-service create) OR management of that compound.
--   3. compounds_insert_self_service now requires: no org OR org-level
--      management (building.manage on that org).
--   4. create_building() uses user_manages_compound instead of
--      user_sees_compound. (It is SECURITY DEFINER so it bypasses the policy,
--      but both layers should agree.)
-- Creating a standalone building/compound (no parent) stays open to any active
-- user, unchanged. building_admin/compound_admin/org_admin all hold
-- building.manage, so legitimate "add a block" flows are unaffected.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION user_manages_compound(p_compound UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT is_platform_admin()
      OR EXISTS (
           SELECT 1 FROM grants g
           WHERE g.user_id = auth.uid()
             AND (g.expires_at IS NULL OR g.expires_at >= CURRENT_DATE)
             AND role_has_cap(g.role, 'building.manage')
             AND ( (g.scope_type = 'compound' AND g.compound_id = p_compound)
                OR (g.scope_type = 'org' AND g.org_id =
                      (SELECT org_id FROM compounds WHERE id = p_compound))
                OR (g.scope_type = 'building' AND EXISTS (
                      SELECT 1 FROM buildings b
                      WHERE b.id = g.building_id AND b.compound_id = p_compound)) ));
$$;
GRANT EXECUTE ON FUNCTION user_manages_compound(UUID) TO authenticated;

-- 2. Buildings: attaching a block into a compound needs management of it.
DROP POLICY IF EXISTS "buildings_insert_self_service" ON buildings;
CREATE POLICY "buildings_insert_self_service" ON buildings
  FOR INSERT TO authenticated
  WITH CHECK (
    is_platform_admin()
    OR (is_active_profile()
        AND (compound_id IS NULL OR user_manages_compound(compound_id)))
  );

-- 3. Compounds: attaching a compound to an org needs org-level management.
DROP POLICY IF EXISTS "compounds_insert_self_service" ON compounds;
CREATE POLICY "compounds_insert_self_service" ON compounds
  FOR INSERT TO authenticated
  WITH CHECK (
    is_platform_admin()
    OR (is_active_profile()
        AND (org_id IS NULL OR EXISTS (
              SELECT 1 FROM grants g
              WHERE g.user_id = auth.uid()
                AND (g.expires_at IS NULL OR g.expires_at >= CURRENT_DATE)
                AND g.scope_type = 'org' AND g.org_id = compounds.org_id
                AND role_has_cap(g.role, 'building.manage'))))
  );

-- 4. Seal the RPC's own guard to match.
CREATE OR REPLACE FUNCTION create_building(
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

  IF NOT (is_platform_admin()
          OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status = 'active')) THEN
    RAISE EXCEPTION 'Not allowed to create a building.' USING ERRCODE = '42501';
  END IF;

  -- 0131: attaching a block to a compound requires MANAGING it, not just
  -- seeing it (was user_sees_compound — true for any resident).
  IF p_compound_id IS NOT NULL AND NOT user_manages_compound(p_compound_id) THEN
    RAISE EXCEPTION 'Not allowed to add a block to that compound.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO buildings (name, address, city, country, contact_email, contact_phone, maps_url, compound_id, is_active)
  VALUES (btrim(p_name), p_address, p_city, p_country, p_contact_email, p_contact_phone, p_maps_url, p_compound_id, TRUE)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMIT;

-- Post-run checks:
--   Compound admin / org admin adds a block to their compound → still works.
--   Building admin of a block adds a sibling block to the same compound → works.
--   A resident (membership only, no grant) tries to create_building with that
--     compound_id, OR a direct INSERT with it → 42501, blocked.
--   Create a standalone building/compound (no parent) → still works for any
--     active user, and the creator is its admin.
