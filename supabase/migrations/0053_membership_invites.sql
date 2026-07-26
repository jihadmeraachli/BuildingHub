-- ============================================================
-- 0053_membership_invites.sql
-- Consent for "Add Abniyah user": linking an existing account to a unit is no
-- longer instant — the admin creates an INVITATION, the person is notified
-- (in-app trigger here; email via dynamic-action webhook), and the membership
-- is created only when THEY accept. Nobody gets attached to units without
-- their knowledge.
--
-- Pieces:
--   1. membership_invites table (+ unique pending per unit×user, expiry 14d)
--   2. RLS — sealed-helper discipline (0047): no direct cross-table subqueries
--   3. In-app notification trigger on invite creation
--   4. my_membership_invites() — the invitee's pending list w/ names
--   5. respond_membership_invite(id, accept) — accept creates the membership
--
-- Additive & idempotent. Transactional.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS membership_invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tenure       TEXT NOT NULL DEFAULT 'owner' CHECK (tenure IN ('owner','tenant')),
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','accepted','declined','cancelled')),
  invited_by   UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '14 days',
  responded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS membership_invites_user_idx ON membership_invites(user_id);
CREATE INDEX IF NOT EXISTS membership_invites_unit_idx ON membership_invites(unit_id);
-- one live invitation per unit × person
CREATE UNIQUE INDEX IF NOT EXISTS membership_invites_pending_idx
  ON membership_invites(unit_id, user_id) WHERE status = 'pending';

-- ------------------------------------------------------------
-- 2. RLS (sealed helpers only — building_of_unit/user_can are SECURITY DEFINER)
-- ------------------------------------------------------------
ALTER TABLE membership_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "membership_invites_select" ON membership_invites;
CREATE POLICY "membership_invites_select" ON membership_invites
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR is_platform_admin()
    OR user_can(building_of_unit(unit_id), 'resident.manage')
  );

DROP POLICY IF EXISTS "membership_invites_insert" ON membership_invites;
CREATE POLICY "membership_invites_insert" ON membership_invites
  FOR INSERT TO authenticated WITH CHECK (
    is_platform_admin()
    OR user_can(building_of_unit(unit_id), 'resident.manage')
  );

-- Admins may withdraw a pending invitation; responses go through the RPC.
DROP POLICY IF EXISTS "membership_invites_delete" ON membership_invites;
CREATE POLICY "membership_invites_delete" ON membership_invites
  FOR DELETE TO authenticated USING (
    (is_platform_admin() OR user_can(building_of_unit(unit_id), 'resident.manage'))
    AND status = 'pending'
  );

-- ------------------------------------------------------------
-- 3. In-app notification on invite
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_on_membership_invite()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_building UUID;
  v_unit     TEXT;
  v_bname    TEXT;
BEGIN
  SELECT u.building_id, u.label INTO v_building, v_unit FROM units u WHERE u.id = NEW.unit_id;
  SELECT b.name INTO v_bname FROM buildings b WHERE b.id = v_building;
  INSERT INTO notifications (user_id, building_id, type, title, body)
  VALUES (
    NEW.user_id, v_building, 'membership_invite',
    'Unit invitation',
    format('You have been invited to unit %s — %s. Open your dashboard to accept or decline.', v_unit, v_bname)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS membership_invites_notify_trg ON membership_invites;
CREATE TRIGGER membership_invites_notify_trg
  AFTER INSERT ON membership_invites
  FOR EACH ROW EXECUTE FUNCTION notify_on_membership_invite();

-- ------------------------------------------------------------
-- 4. The invitee's pending list (names resolved server-side — the invitee
--    may not be able to read the unit/building rows yet).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION my_membership_invites()
RETURNS TABLE(
  id            UUID,
  unit_label    TEXT,
  building_name TEXT,
  tenure        TEXT,
  invited_by    TEXT,
  created_at    TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT mi.id, u.label, b.name, mi.tenure,
         COALESCE(p.full_name, '—'), mi.created_at
  FROM membership_invites mi
  JOIN units u     ON u.id = mi.unit_id
  JOIN buildings b ON b.id = u.building_id
  LEFT JOIN profiles p ON p.id = mi.invited_by
  WHERE mi.user_id = auth.uid()
    AND mi.status = 'pending'
    AND mi.expires_at > now()
  ORDER BY mi.created_at DESC;
$$;

-- ------------------------------------------------------------
-- 5. Respond — only the invitee, only while pending; accept creates the
--    membership (skipping if one already exists).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION respond_membership_invite(p_invite UUID, p_accept BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v membership_invites%ROWTYPE;
BEGIN
  SELECT * INTO v FROM membership_invites
  WHERE id = p_invite AND user_id = auth.uid() AND status = 'pending' AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found, already answered, or expired.' USING ERRCODE = '42501';
  END IF;

  IF p_accept THEN
    IF NOT EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.unit_id = v.unit_id AND m.user_id = v.user_id AND m.ended_at IS NULL
    ) THEN
      INSERT INTO memberships (user_id, unit_id, tenure) VALUES (v.user_id, v.unit_id, v.tenure);
    END IF;
    UPDATE membership_invites SET status = 'accepted', responded_at = now() WHERE id = p_invite;
  ELSE
    UPDATE membership_invites SET status = 'declined', responded_at = now() WHERE id = p_invite;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION my_membership_invites()                    TO authenticated;
GRANT EXECUTE ON FUNCTION respond_membership_invite(UUID, BOOLEAN)   TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   1. Admin: Add Abniyah user → row appears in membership_invites (pending),
--      target gets a 🔔 notification; NO membership row yet.
--   2. Target signs in → dashboard banner → Accept → membership exists,
--      invite status 'accepted'. Decline → no membership.
--   3. Second pending invite for same unit+user → unique violation.
-- ============================================================
