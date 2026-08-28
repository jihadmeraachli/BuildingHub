-- ============================================================
-- 0154_lost_and_found.sql
-- Lost & Found (Jey, 2026-08-28).
--
-- Anyone in the building - resident or manager - can post a found item with
-- a photo taken on the spot. Every member gets an in-app notification ("new
-- item, check if it's yours"). Any member can CLAIM an open item; claiming
-- goes through a sealed RPC (not a direct UPDATE) so a resident can flip
-- exactly one thing: open -> claimed by me. Everyone then sees "claimed";
-- managers additionally see WHO (client joins profiles, which manager RLS
-- already permits - residents never fetch the name). Managers mark items
-- returned, fix mistakes, or delete.
--
-- Scope is the BLOCK (building_id): items are found in a building. Compound
-- managers see every block's items through their grants as usual.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS lost_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id  UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  photo_url    TEXT,
  found_where  TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'returned')),
  created_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  claimed_at   TIMESTAMPTZ,
  -- a claimed/returned row must know by whom; an open row must not
  CONSTRAINT lost_items_claim_pair CHECK ((status = 'open') = (claimed_by IS NULL))
);
CREATE INDEX IF NOT EXISTS lost_items_building_idx ON lost_items(building_id, created_at DESC);

ALTER TABLE lost_items ENABLE ROW LEVEL SECURITY;

-- Read: managers of the building, or its residents (pattern: issues 0007).
DROP POLICY IF EXISTS lost_items_select ON lost_items;
CREATE POLICY lost_items_select ON lost_items FOR SELECT USING (
  is_platform_admin()
  OR user_can(building_id, 'issue.view_all')
  OR user_member_building(building_id)
);

-- Post: must be the poster, and belong to the building (member or manager).
DROP POLICY IF EXISTS lost_items_insert ON lost_items;
CREATE POLICY lost_items_insert ON lost_items FOR INSERT WITH CHECK (
  created_by = auth.uid()
  AND status = 'open'
  AND (
    is_platform_admin()
    OR user_can(building_id, 'issue.update')
    OR user_member_building(building_id)
  )
);

-- Update/Delete: managers only. Residents claim via the sealed RPC below.
DROP POLICY IF EXISTS lost_items_update ON lost_items;
CREATE POLICY lost_items_update ON lost_items FOR UPDATE USING (
  is_platform_admin() OR user_can(building_id, 'issue.update')
) WITH CHECK (
  is_platform_admin() OR user_can(building_id, 'issue.update')
);
DROP POLICY IF EXISTS lost_items_delete ON lost_items;
CREATE POLICY lost_items_delete ON lost_items FOR DELETE USING (
  is_platform_admin() OR user_can(building_id, 'issue.update')
);

-- ------------------------------------------------------------
-- Claiming: one sealed door. A member flips open -> claimed-by-me and
-- can change nothing else. First claim wins (row lock + status check).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_lost_item(p_item UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_item lost_items;
BEGIN
  SELECT * INTO v_item FROM lost_items WHERE id = p_item FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Item not found.' USING ERRCODE = '22023';
  END IF;
  IF NOT (is_platform_admin()
          OR user_can(v_item.building_id, 'issue.update')
          OR user_member_building(v_item.building_id)) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  IF v_item.status <> 'open' THEN
    RAISE EXCEPTION 'This item was already claimed.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE lost_items
     SET status = 'claimed', claimed_by = auth.uid(), claimed_at = now()
   WHERE id = p_item;
END;
$$;
GRANT EXECUTE ON FUNCTION claim_lost_item(UUID) TO authenticated;

-- ------------------------------------------------------------
-- Notifications (pattern: 0009). New item -> every resident and admin of the
-- building except the poster. Claim -> the poster and the admins.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_on_lost_item() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT DISTINCT uid, NEW.building_id, 'lost_found_new',
         'Lost & found', 'New item: ' || NEW.title || ' — check if it''s yours.'
  FROM (
    SELECT m.user_id AS uid FROM memberships m JOIN units u ON u.id = m.unit_id
      WHERE u.building_id = NEW.building_id AND m.ended_at IS NULL
    UNION
    SELECT uid FROM building_admin_ids(NEW.building_id)
  ) x
  WHERE uid <> COALESCE(NEW.created_by, '00000000-0000-0000-0000-000000000000'::uuid);
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_lost_item ON lost_items;
CREATE TRIGGER trg_notify_lost_item AFTER INSERT ON lost_items
  FOR EACH ROW EXECUTE FUNCTION notify_on_lost_item();

CREATE OR REPLACE FUNCTION notify_on_lost_item_claim() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.status = 'open' AND NEW.status = 'claimed' THEN
    INSERT INTO notifications (user_id, building_id, type, title, body)
    SELECT DISTINCT uid, NEW.building_id, 'lost_found_claimed',
           'Lost & found', '"' || NEW.title || '" was claimed.'
    FROM (
      SELECT uid FROM building_admin_ids(NEW.building_id)
      UNION
      SELECT NEW.created_by
    ) x
    WHERE uid IS NOT NULL AND uid <> NEW.claimed_by;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_lost_item_claim ON lost_items;
CREATE TRIGGER trg_notify_lost_item_claim AFTER UPDATE ON lost_items
  FOR EACH ROW EXECUTE FUNCTION notify_on_lost_item_claim();

COMMIT;

-- ============================================================
-- Post-run checks (SQL Editor):
--   1. As a resident: INSERT a lost item into their building → allowed;
--      into another building → RLS refuses. Every other member + the admins
--      get a 'lost_found_new' notification; the poster does not.
--   2. SELECT claim_lost_item('<id>') as another resident → status='claimed',
--      claimed_by set; a second claim → 'already claimed'. Poster + admins
--      get 'lost_found_claimed'.
--   3. A resident UPDATE on lost_items directly → RLS refuses (the RPC is
--      the only resident door).
--   4. node scripts/rls-audit.mjs — lost_items invisible off-scope.
-- ============================================================
