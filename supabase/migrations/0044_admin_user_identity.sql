-- ============================================================
-- 0044_admin_user_identity.sql
-- The People edit modal shows (read-only) the user's email and whether 2FA is
-- enabled. Both live in the auth schema, which the client can't read for other
-- users — this SECURITY DEFINER RPC exposes exactly those two facts, only to
-- callers with people-management authority over the target:
--   platform admin, or resident.manage on the target's home building, or
--   resident.manage on any building where the target has an active membership.
--
-- Deliberately NOT exposed: anything writable. Email/password/2FA changes stay
-- self-service (Settings) — admin-changeable email would be a takeover vector.
--
-- Additive & idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_user_identity(p_user UUID)
RETURNS TABLE(email TEXT, mfa_enabled BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> p_user
     AND NOT is_platform_admin()
     AND NOT COALESCE(
           user_can((SELECT building_id FROM profiles WHERE id = p_user), 'resident.manage'),
           FALSE)
     AND NOT EXISTS (
           SELECT 1 FROM memberships m
           JOIN units un ON un.id = m.unit_id
           WHERE m.user_id = p_user AND m.ended_at IS NULL
             AND user_can(un.building_id, 'resident.manage')
         ) THEN
    RAISE EXCEPTION 'Not authorized for this user.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT u.email::TEXT,
           EXISTS (
             SELECT 1 FROM auth.mfa_factors f
             WHERE f.user_id = p_user AND f.status = 'verified'
           ) AS mfa_enabled
    FROM auth.users u
    WHERE u.id = p_user;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_user_identity(UUID) TO authenticated;

-- ============================================================
-- Post-run checks:
--   -- As an org admin (app console), for a resident in your org:
--   supabase.rpc('admin_user_identity', {p_user: '<their-uuid>'})
--   -- expect: [{ email: '...', mfa_enabled: false }]
--   -- As a resident, for someone else's uuid: expect 'Not authorized'.
-- ============================================================
