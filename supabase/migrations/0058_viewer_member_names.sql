-- ============================================================
-- 0058_viewer_member_names.sql
-- Read-only roles see WHO lives where — names only.
--
-- The viewer role (auditor / committee oversight, and the public demo's
-- "View as admin" persona) can read the finance book, where unit balances
-- only mean something if you know whose unit it is. But can_view_profile
-- (0054) rightly refuses full profiles to non-managers: a viewer has no
-- business reading phone numbers or notification settings.
--
-- This sealed helper (0047 discipline, same shape as admin_membership_invites
-- in 0055) returns active memberships with the member's FULL NAME and nothing
-- else, gated per building on finance.view. Contact details stay behind
-- resident.manage.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION structure_members(p_building_ids UUID[])
RETURNS TABLE(
  unit_id   UUID,
  user_id   UUID,
  tenure    TEXT,
  full_name TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT m.unit_id, m.user_id, m.tenure, COALESCE(p.full_name, '—')
  FROM memberships m
  JOIN units u ON u.id = m.unit_id
  LEFT JOIN profiles p ON p.id = m.user_id
  WHERE u.building_id = ANY(p_building_ids)
    AND m.ended_at IS NULL
    AND (is_platform_admin() OR user_can(u.building_id, 'finance.view'))
  ORDER BY m.created_at;
$$;

GRANT EXECUTE ON FUNCTION structure_members(UUID[]) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   1. As the demo viewer: SELECT * FROM structure_members(ARRAY['df12b7e3-0d8e-4dac-8283-b70778d82ee3']::uuid[])
--      → all Tulip memberships with names.
--   2. As an unrelated resident: same call → zero rows.
-- ============================================================
