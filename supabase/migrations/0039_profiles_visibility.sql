-- ============================================================
-- 0039_profiles_visibility.sql
-- Bug: invited residents don't appear in People for org admins. The profiles
-- SELECT policy predates the migrations folder (it lives only in the live DB,
-- from the v2 era) and is not grants-aware — org/compound admins may not be
-- able to read profiles of people in their buildings at all.
--
-- Fix: ADD a grants-aware SELECT policy. RLS policies are permissive (OR'd),
-- so adding one can only widen visibility — the legacy policy keeps working
-- for whatever it already allowed. No DROP of unknown policies.
--
-- Who can see a profile under the new policy:
--   1. yourself
--   2. platform admin (god-mode)
--   3. managers with resident.manage on the profile's home building
--      (user_can cascades building ← compound ← org grants, 0027)
--   4. managers with resident.manage on any building where the person has an
--      ACTIVE membership (covers residents whose profile.building_id is unset)
--   5. managers with grant.manage covering any scope the person holds a grant
--      on (so the Access tab can render grant-holder names)
--
-- Additive & idempotent.
-- ============================================================

DROP POLICY IF EXISTS "profiles_select_v3" ON profiles;
CREATE POLICY "profiles_select_v3" ON profiles
  FOR SELECT TO authenticated USING (
    id = auth.uid()
    OR is_platform_admin()
    OR (building_id IS NOT NULL AND user_can(building_id, 'resident.manage'))
    OR EXISTS (
        SELECT 1 FROM memberships m
        JOIN units un ON un.id = m.unit_id
        WHERE m.user_id = profiles.id
          AND m.ended_at IS NULL
          AND user_can(un.building_id, 'resident.manage')
      )
    OR EXISTS (
        SELECT 1 FROM grants g
        WHERE g.user_id = profiles.id
          AND (
            (g.building_id IS NOT NULL AND user_can(g.building_id, 'grant.manage'))
            OR (g.compound_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM buildings b
                  WHERE b.compound_id = g.compound_id AND user_can(b.id, 'grant.manage')))
            OR (g.org_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM org_buildings ob
                  WHERE ob.org_id = g.org_id AND user_can(ob.building_id, 'grant.manage')))
          )
      )
  );

-- ============================================================
-- Post-run checks:
--   -- 1. As the org admin (app console): the invited resident appears in
--   --    People → All users of their building.
--   -- 2. As a resident: you can still see your own profile (Settings loads).
--   -- 3. Inventory of profiles policies (SQL editor, for the audit):
--   SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS rule
--   FROM pg_policy JOIN pg_class ON pg_class.oid = polrelid
--   WHERE relname = 'profiles';
-- ============================================================
