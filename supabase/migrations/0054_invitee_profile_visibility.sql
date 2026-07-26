-- 0054: Admins can see the profile of someone they have INVITED to a unit
-- (pending membership_invites, 0053) — before that, an invitee with no other
-- tie to the building was invisible in People, so admins couldn't track or
-- withdraw the invitation. Adds one arm to the sealed visibility helper.
-- Additive & idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION can_view_profile(p_profile UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    p_profile = auth.uid()
    OR is_platform_admin()
    OR EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = p_profile
          AND p.building_id IS NOT NULL
          AND user_can(p.building_id, 'resident.manage')
      )
    OR EXISTS (
        SELECT 1 FROM memberships m
        JOIN units un ON un.id = m.unit_id
        WHERE m.user_id = p_profile
          AND m.ended_at IS NULL
          AND user_can(un.building_id, 'resident.manage')
      )
    OR EXISTS (
        SELECT 1 FROM membership_invites mi
        JOIN units un ON un.id = mi.unit_id
        WHERE mi.user_id = p_profile
          AND mi.status = 'pending'
          AND user_can(un.building_id, 'resident.manage')
      )
    OR EXISTS (
        SELECT 1 FROM grants g
        WHERE g.user_id = p_profile
          AND (
            (g.building_id IS NOT NULL AND user_can(g.building_id, 'grant.manage'))
            OR (g.compound_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM buildings b
                  WHERE b.compound_id = g.compound_id AND user_can(b.id, 'grant.manage')))
            OR (g.org_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM org_buildings ob
                  WHERE ob.org_id = g.org_id AND user_can(ob.building_id, 'grant.manage')))
          )
      );
$$;

COMMIT;
