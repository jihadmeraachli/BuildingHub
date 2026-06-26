-- ============================================================
-- BuildingHub — Dues / fixed prepayments (B1 model)
-- A dues PLAN per building or compound (admin picks cadence + method).
-- Generating a period creates one DUES item per unit, auto-trued-up:
--   amount_due = max(0, base − current_balance)
-- Dues are a visible "expected prepayment" item, NOT a charge (no
-- double-count with actual expenses). Safe to re-run.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---- plan (per building XOR compound) ----
CREATE TABLE IF NOT EXISTS dues_plans (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  building_id UUID REFERENCES buildings(id) ON DELETE CASCADE,
  compound_id UUID REFERENCES compounds(id) ON DELETE CASCADE,
  cadence     TEXT NOT NULL CHECK (cadence IN ('monthly','quarterly','semiannual','annual')),
  method      TEXT NOT NULL CHECK (method IN ('by_shares','equal','custom')),
  pool_amount NUMERIC(12,2),        -- total per period (for by_shares / equal)
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dues_plan_scope CHECK ((building_id IS NOT NULL) <> (compound_id IS NOT NULL))
);

-- ---- custom per-unit base (only used when method = 'custom') ----
CREATE TABLE IF NOT EXISTS dues_unit_amounts (
  plan_id UUID NOT NULL REFERENCES dues_plans(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (plan_id, unit_id)
);

-- ---- generated dues items (per unit, per period) ----
CREATE TABLE IF NOT EXISTS dues (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id      UUID REFERENCES dues_plans(id) ON DELETE SET NULL,
  building_id  UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  unit_id      UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  period_label TEXT NOT NULL,
  due_date     DATE,
  base_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  carry_in     NUMERIC(12,2) NOT NULL DEFAULT 0,  -- −balance at generation (transparency)
  amount_due   NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by   UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dues_unit_idx ON dues(unit_id);
CREATE INDEX IF NOT EXISTS dues_building_idx ON dues(building_id, period_label);

-- ---- RLS ----
ALTER TABLE dues_plans        ENABLE ROW LEVEL SECURITY;
ALTER TABLE dues_unit_amounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE dues              ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dues_plans_select ON dues_plans;
DROP POLICY IF EXISTS dues_plans_write ON dues_plans;
DROP POLICY IF EXISTS dues_amounts_all ON dues_unit_amounts;
DROP POLICY IF EXISTS dues_select ON dues;
DROP POLICY IF EXISTS dues_write ON dues;

CREATE POLICY dues_plans_select ON dues_plans FOR SELECT USING (
  is_platform_admin()
  OR (building_id IS NOT NULL AND (user_can(building_id,'finance.view') OR user_member_building(building_id)))
  OR (compound_id IS NOT NULL AND EXISTS (SELECT 1 FROM buildings b WHERE b.compound_id = dues_plans.compound_id
        AND (user_can(b.id,'finance.view') OR user_member_building(b.id))))
);
CREATE POLICY dues_plans_write ON dues_plans FOR ALL USING (
  is_platform_admin()
  OR (building_id IS NOT NULL AND user_can(building_id,'expense.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (SELECT 1 FROM buildings b WHERE b.compound_id = dues_plans.compound_id AND user_can(b.id,'expense.manage')))
) WITH CHECK (
  is_platform_admin()
  OR (building_id IS NOT NULL AND user_can(building_id,'expense.manage'))
  OR (compound_id IS NOT NULL AND EXISTS (SELECT 1 FROM buildings b WHERE b.compound_id = dues_plans.compound_id AND user_can(b.id,'expense.manage')))
);

CREATE POLICY dues_amounts_all ON dues_unit_amounts FOR ALL
  USING (is_platform_admin() OR user_can(building_of_unit(unit_id),'expense.manage'))
  WITH CHECK (is_platform_admin() OR user_can(building_of_unit(unit_id),'expense.manage'));

CREATE POLICY dues_select ON dues FOR SELECT USING (
  user_can(building_id,'finance.view') OR unit_id IN (SELECT user_unit_ids()) OR user_member_building(building_id)
);
CREATE POLICY dues_write ON dues FOR ALL
  USING (user_can(building_id,'charge.manage'))
  WITH CHECK (user_can(building_id,'charge.manage'));

-- ---- notify unit owner when dues are issued ----
CREATE OR REPLACE FUNCTION notify_on_dues() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT m.user_id, NEW.building_id, 'dues_issued',
         'Dues due', 'Your dues for ' || NEW.period_label || ' are $' || NEW.amount_due ||
         COALESCE(' — due ' || NEW.due_date::text, '')
  FROM memberships m WHERE m.unit_id = NEW.unit_id;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_dues ON dues;
CREATE TRIGGER trg_notify_dues AFTER INSERT ON dues FOR EACH ROW EXECUTE FUNCTION notify_on_dues();

-- dues edited (amount changed) -> owner
CREATE OR REPLACE FUNCTION notify_on_dues_update() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.amount_due IS DISTINCT FROM OLD.amount_due THEN
    INSERT INTO notifications (user_id, building_id, type, title, body)
    SELECT m.user_id, NEW.building_id, 'dues_updated',
           'Dues updated', 'Your dues for ' || NEW.period_label || ' were updated to $' || NEW.amount_due
    FROM memberships m WHERE m.unit_id = NEW.unit_id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_dues_update ON dues;
CREATE TRIGGER trg_notify_dues_update AFTER UPDATE ON dues FOR EACH ROW EXECUTE FUNCTION notify_on_dues_update();

-- dues removed -> owner
CREATE OR REPLACE FUNCTION notify_on_dues_delete() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, building_id, type, title, body)
  SELECT m.user_id, OLD.building_id, 'dues_removed',
         'Dues removed', 'Your dues for ' || OLD.period_label || ' were removed'
  FROM memberships m WHERE m.unit_id = OLD.unit_id;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_dues_delete ON dues;
CREATE TRIGGER trg_notify_dues_delete AFTER DELETE ON dues FOR EACH ROW EXECUTE FUNCTION notify_on_dues_delete();
