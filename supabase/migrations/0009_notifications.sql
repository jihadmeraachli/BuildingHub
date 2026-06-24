-- ============================================================
-- BuildingHub — in-app notifications via DB triggers
-- Emits on: charge issued, payment recorded, meeting scheduled,
-- new issue (to admins), issue resolved (to reporter).
-- Triggers are SECURITY DEFINER so they fan out across users
-- regardless of the actor's RLS. Safe to re-run.
-- ============================================================

-- allow the new notification types
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

-- ---- helpers ----
-- admin user ids for a building (grants + org grants + platform + legacy roles)
CREATE OR REPLACE FUNCTION building_admin_ids(p_building UUID)
RETURNS TABLE(uid UUID) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT g.user_id FROM grants g WHERE g.scope_type = 'building' AND g.building_id = p_building
  UNION
  SELECT g.user_id FROM grants g JOIN org_buildings ob ON ob.org_id = g.org_id
    WHERE g.scope_type = 'org' AND ob.building_id = p_building
  UNION
  SELECT p.id FROM profiles p WHERE p.is_platform_admin
  UNION
  SELECT p.id FROM profiles p WHERE p.role = 'super_admin'
  UNION
  SELECT p.id FROM profiles p WHERE p.role = 'building_admin' AND p.building_id = p_building;
$$;

-- ---- charge issued -> unit owners ----
CREATE OR REPLACE FUNCTION notify_on_charge() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT m.user_id, NEW.building_id, 'charge_issued',
         'New charge', COALESCE(NEW.description, 'Charge') || ' — $' || NEW.amount_usd
  FROM memberships m WHERE m.unit_id = NEW.unit_id;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_charge ON charges;
CREATE TRIGGER trg_notify_charge AFTER INSERT ON charges FOR EACH ROW EXECUTE FUNCTION notify_on_charge();

-- ---- payment recorded -> unit owners (receipt) ----
CREATE OR REPLACE FUNCTION notify_on_payment() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT m.user_id, NEW.building_id, 'payment_received',
         'Payment recorded', '$' || NEW.amount_usd || ' received — thank you'
  FROM memberships m WHERE m.unit_id = NEW.unit_id;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_payment ON payments;
CREATE TRIGGER trg_notify_payment AFTER INSERT ON payments FOR EACH ROW EXECUTE FUNCTION notify_on_payment();

-- ---- meeting scheduled -> all building members ----
CREATE OR REPLACE FUNCTION notify_on_meeting() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT DISTINCT m.user_id, NEW.building_id, 'new_meeting', 'New meeting', NEW.title
  FROM memberships m JOIN units u ON u.id = m.unit_id
  WHERE u.building_id = NEW.building_id;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_meeting ON meetings;
CREATE TRIGGER trg_notify_meeting AFTER INSERT ON meetings FOR EACH ROW EXECUTE FUNCTION notify_on_meeting();

-- ---- new issue -> building admins (not the reporter) ----
CREATE OR REPLACE FUNCTION notify_on_issue() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT DISTINCT a.uid, NEW.building_id, 'new_issue', 'New issue reported', NEW.title
  FROM building_admin_ids(NEW.building_id) a
  WHERE a.uid <> NEW.reported_by;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_issue ON issues;
CREATE TRIGGER trg_notify_issue AFTER INSERT ON issues FOR EACH ROW EXECUTE FUNCTION notify_on_issue();

-- ---- issue resolved -> reporter ----
CREATE OR REPLACE FUNCTION notify_on_issue_resolved() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved' THEN
    INSERT INTO notifications (user_id, building_id, type, title, body)
    VALUES (NEW.reported_by, NEW.building_id, 'issue_update', 'Issue resolved', NEW.title);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_issue_resolved ON issues;
CREATE TRIGGER trg_notify_issue_resolved AFTER UPDATE ON issues FOR EACH ROW EXECUTE FUNCTION notify_on_issue_resolved();
