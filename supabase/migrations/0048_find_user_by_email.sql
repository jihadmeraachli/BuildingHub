-- ============================================================
-- 0048_find_user_by_email.sql
-- "Add Abniyah user" (People page): an admin types the email of an EXISTING
-- account (e.g. someone provisioned in another building) and links them to a
-- unit here — one account, many units.
--
-- Emails live in auth.users, which the client cannot query — this sealed RPC
-- resolves email → (user_id, full_name), restricted to people-managers:
-- platform admin, or any grant whose role carries resident.manage.
--
-- Deliberately minimal: returns nothing else, no wildcard search (exact email
-- only), so it can't be used to enumerate accounts beyond what an admin could
-- learn by attempting an invite anyway.
--
-- Additive & idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION find_user_by_email(p_email TEXT)
RETURNS TABLE(user_id UUID, full_name TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT is_platform_admin()
     AND NOT EXISTS (
           SELECT 1 FROM grants g
           WHERE g.user_id = auth.uid()
             AND role_has_cap(g.role, 'resident.manage')
         ) THEN
    RAISE EXCEPTION 'Not authorized.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT u.id, p.full_name
    FROM auth.users u
    JOIN profiles p ON p.id = u.id
    WHERE lower(u.email) = lower(trim(p_email))
    LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION find_user_by_email(TEXT) TO authenticated;

-- ============================================================
-- Post-run check (as an admin in the app console):
--   supabase.rpc('find_user_by_email', {p_email: '<existing email>'})
--   -- expect: [{ user_id, full_name }]; unknown email → []
-- ============================================================
