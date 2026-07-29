-- ============================================================
-- 0055_admin_invite_tracking.sql
-- Admin invitation tracking (People → Invitations tab): managers see every
-- unit invitation in their scope — pending, accepted, declined, expired —
-- with names resolved server-side. Client-side joins can't do this: RLS
-- (0054) only exposes an invitee's PROFILE while the invite is pending, so a
-- declined invitee's name would come back empty exactly where the admin most
-- wants it. SECURITY DEFINER + an explicit user_can() check per building
-- keeps it safe (sealed-helper discipline, 0047).
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION admin_membership_invites(p_building_ids UUID[])
RETURNS TABLE(
  id              UUID,
  unit_id         UUID,
  unit_label      TEXT,
  building_id     UUID,
  building_name   TEXT,
  user_id         UUID,
  user_name       TEXT,
  tenure          TEXT,
  status          TEXT,   -- effective: 'expired' when pending past expires_at
  invited_by_name TEXT,
  created_at      TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  responded_at    TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT mi.id, mi.unit_id, u.label, u.building_id, b.name,
         mi.user_id, COALESCE(pu.full_name, '—'), mi.tenure,
         CASE WHEN mi.status = 'pending' AND mi.expires_at <= now()
              THEN 'expired' ELSE mi.status END,
         COALESCE(pi.full_name, '—'),
         mi.created_at, mi.expires_at, mi.responded_at
  FROM membership_invites mi
  JOIN units u     ON u.id = mi.unit_id
  JOIN buildings b ON b.id = u.building_id
  LEFT JOIN profiles pu ON pu.id = mi.user_id
  LEFT JOIN profiles pi ON pi.id = mi.invited_by
  WHERE u.building_id = ANY(p_building_ids)
    AND (is_platform_admin() OR user_can(u.building_id, 'resident.manage'))
  ORDER BY mi.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION admin_membership_invites(UUID[]) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   1. As building admin: SELECT * FROM admin_membership_invites(ARRAY[<your building>]::uuid[])
--      → all invites for that building's units, incl. declined ones WITH names.
--   2. As an unrelated user: same call → zero rows (user_can gate).
-- ============================================================
