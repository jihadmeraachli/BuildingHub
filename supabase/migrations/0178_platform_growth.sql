-- 0178 — platform_growth(): the operator's launch dashboard in one call.
--
-- Who signed up, when, from where, what they created, who is on the waitlist,
-- and sign-ups per day — read-only, platform admins only. auth.users is not
-- reachable from the client, so this SECURITY DEFINER function is the only
-- door, and it refuses anyone who is not a platform admin.
--
-- p_include_test = FALSE hides our own accounts (jihad.meraachli+…, @tatawwor.com,
-- demo personas) so the numbers mean customers.
-- Additive & idempotent.

CREATE OR REPLACE FUNCTION platform_growth(p_days INT DEFAULT 30, p_include_test BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_since TIMESTAMPTZ := now() - make_interval(days => GREATEST(1, LEAST(p_days, 365)));
  v_result JSONB;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;

  WITH people AS (
    SELECT u.id, u.email, u.created_at, u.last_sign_in_at,
           p.full_name, p.is_demo,
           (NOT p_include_test) AND (
             COALESCE(p.is_demo, FALSE)
             OR u.email ILIKE 'jihad.meraachli%'
             OR u.email ILIKE '%@tatawwor.com'
             OR u.email ILIKE 'jey@meraachli.com'
           ) AS is_test
    FROM auth.users u
    LEFT JOIN profiles p ON p.id = u.id
  ),
  real_people AS (SELECT * FROM people WHERE NOT is_test),
  subs AS (
    SELECT s.id, s.status, s.plan, s.scope_type, s.license_count, s.billing_email, s.trial_ends_at,
           s.current_period_end, s.created_at, s.created_by,
           COALESCE(b.name, c.name, o.name) AS scope_name,
           COALESCE(b.city, c.city) AS city
    FROM subscriptions s
    LEFT JOIN buildings b ON b.id = s.building_id
    LEFT JOIN compounds c ON c.id = s.compound_id
    LEFT JOIN organizations o ON o.id = s.org_id
    WHERE s.status <> 'cancelled'
      AND (p_include_test OR (
        s.billing_email NOT ILIKE 'jihad.meraachli%'
        AND s.billing_email NOT ILIKE '%@tatawwor.com'
        AND COALESCE(s.billing_email, '') NOT ILIKE 'jey@meraachli.com'
        AND s.trial_ends_at IS DISTINCT FROM '2099-01-01'::timestamptz))
  ),
  days AS (
    SELECT d::date AS day FROM generate_series(v_since::date, CURRENT_DATE, interval '1 day') d
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'days', p_days,
    'totals', jsonb_build_object(
      'accounts_total', (SELECT count(*) FROM real_people),
      'accounts_period', (SELECT count(*) FROM real_people WHERE created_at >= v_since),
      'accounts_7d', (SELECT count(*) FROM real_people WHERE created_at >= now() - interval '7 days'),
      'trials', (SELECT count(*) FROM subs WHERE status = 'trial'),
      'active', (SELECT count(*) FROM subs WHERE status = 'active'),
      'past_due', (SELECT count(*) FROM subs WHERE status IN ('past_due', 'grace', 'locked')),
      'buildings_period', (SELECT count(*) FROM buildings WHERE created_at >= v_since AND deleted_at IS NULL),
      'waitlist_total', (SELECT count(*) FROM waitlist),
      'waitlist_period', (SELECT count(*) FROM waitlist WHERE created_at >= v_since)
    ),
    'signups_by_day', (
      SELECT jsonb_agg(jsonb_build_object('day', d.day, 'n', COALESCE(x.n, 0)) ORDER BY d.day)
      FROM days d LEFT JOIN (
        SELECT created_at::date AS day, count(*) AS n FROM real_people WHERE created_at >= v_since GROUP BY 1
      ) x ON x.day = d.day
    ),
    'signups', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', rp.id, 'email', rp.email, 'name', rp.full_name,
        'created_at', rp.created_at, 'last_sign_in_at', rp.last_sign_in_at,
        'kind', CASE
          WHEN EXISTS (SELECT 1 FROM grants g WHERE g.user_id = rp.id) THEN 'manager'
          WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = rp.id AND m.ended_at IS NULL) THEN 'resident'
          ELSE 'none' END,
        'scope', (SELECT COALESCE(b.name, c.name, o.name) FROM grants g
                    LEFT JOIN buildings b ON b.id = g.building_id
                    LEFT JOIN compounds c ON c.id = g.compound_id
                    LEFT JOIN organizations o ON o.id = g.org_id
                  WHERE g.user_id = rp.id ORDER BY g.created_at LIMIT 1),
        'building', (SELECT b.name FROM memberships m JOIN units un ON un.id = m.unit_id JOIN buildings b ON b.id = un.building_id
                     WHERE m.user_id = rp.id AND m.ended_at IS NULL ORDER BY m.created_at LIMIT 1)
      ) ORDER BY rp.created_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM real_people ORDER BY created_at DESC LIMIT 200) rp
    ),
    'subscriptions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id, 'status', s.status, 'plan', s.plan, 'scope_type', s.scope_type, 'scope_name', s.scope_name, 'city', s.city,
        'license_count', s.license_count, 'billing_email', s.billing_email, 'trial_ends_at', s.trial_ends_at,
        'current_period_end', s.current_period_end, 'created_at', s.created_at
      ) ORDER BY s.created_at DESC), '[]'::jsonb)
      FROM subs s
    ),
    'waitlist', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', w.id, 'email', w.email, 'locale', w.locale, 'source', w.source, 'created_at', w.created_at) ORDER BY w.created_at DESC), '[]'::jsonb)
      FROM waitlist w
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION platform_growth(INT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION platform_growth(INT, BOOLEAN) TO authenticated, service_role;
