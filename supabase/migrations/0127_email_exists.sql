-- 0127: email existence check for the forgot-password flow.
--
-- Product decision (Jey, Aug 2026): the reset form should tell the user when
-- the email has no account, instead of silently "sending" to nowhere.
-- Trade-off, stated openly: this makes email enumeration possible (anyone can
-- ask "does x@y.com have an account?"). Accepted for UX; Supabase Auth
-- rate-limits per IP and the function reveals a boolean only, nothing else.
--
-- Additive + idempotent. Run in the SQL Editor as usual.

CREATE OR REPLACE FUNCTION public.email_exists(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE lower(email) = lower(trim(p_email))
      AND deleted_at IS NULL
  );
$$;

-- Anon must be able to call it: forgot-password happens before sign-in.
REVOKE ALL ON FUNCTION public.email_exists(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_exists(TEXT) TO anon, authenticated;
