-- ============================================================
-- BuildingHub — v3 Foundation (ADDITIVE migration)
-- Implements docs/WORKFLOW.md: orgs, grants, compounds, units,
-- memberships, groups, and the expense→charge→payment model.
--
-- SAFE TO RUN ON AN EXISTING DB:
--   * Only ADDS tables/columns/functions (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
--   * Does NOT drop or alter existing tables, policies, or data.
--   * The existing app keeps working on profiles.role / billing_entries.
--   * The UI is migrated onto these tables in a later phase.
--
-- Run this AFTER schema.sql, in the Supabase SQL Editor.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. IDENTITY ADD-ONS
-- ============================================================

-- Platform admin bypass flag (bootstrap: see §9 at bottom).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- 2. ORGANIZATIONS (optional management companies)
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Which buildings an org manages (many-to-many).
CREATE TABLE IF NOT EXISTS org_buildings (
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, building_id)
);

-- ============================================================
-- 3. COMPOUNDS (optional) + link buildings (blocks) to them
-- ============================================================
CREATE TABLE IF NOT EXISTS compounds (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  city       TEXT,
  country    TEXT NOT NULL DEFAULT 'Lebanon',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A "building" row now also plays the role of a block within a compound.
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS compound_id UUID REFERENCES compounds(id) ON DELETE SET NULL;

-- ============================================================
-- 4. GRANTS (management access). scope = org OR building.
-- ============================================================
CREATE TABLE IF NOT EXISTS grants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scope_type  TEXT NOT NULL CHECK (scope_type IN ('org', 'building')),
  org_id      UUID REFERENCES organizations(id) ON DELETE CASCADE,
  building_id UUID REFERENCES buildings(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN
                ('org_admin','org_finance','building_admin','building_finance','viewer')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT grants_scope_chk CHECK (
    (scope_type = 'org'      AND org_id IS NOT NULL AND building_id IS NULL) OR
    (scope_type = 'building' AND building_id IS NOT NULL AND org_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS grants_user_idx ON grants(user_id);
CREATE INDEX IF NOT EXISTS grants_building_idx ON grants(building_id);
CREATE INDEX IF NOT EXISTS grants_org_idx ON grants(org_id);

-- ============================================================
-- 5. UNITS + MEMBERSHIPS (resident side) + GROUPS
-- ============================================================
CREATE TABLE IF NOT EXISTS units (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  building_id  UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,                       -- apartment number / name
  share_weight NUMERIC(10,2) NOT NULL DEFAULT 1,    -- traditional حصص weight
  occupancy    TEXT NOT NULL DEFAULT 'occupied'
               CHECK (occupancy IN ('occupied','vacant','abroad')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS units_building_idx ON units(building_id);

CREATE TABLE IF NOT EXISTS memberships (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  unit_id    UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  tenure     TEXT NOT NULL DEFAULT 'owner' CHECK (tenure IN ('owner','tenant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, unit_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);
CREATE INDEX IF NOT EXISTS memberships_unit_idx ON memberships(unit_id);

CREATE TABLE IF NOT EXISTS groups (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS unit_groups (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  unit_id  UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, unit_id)
);

-- ============================================================
-- 6. FINANCE: expenses → charges, and payments
-- ============================================================
CREATE TABLE IF NOT EXISTS expenses (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  building_id  UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  category     TEXT NOT NULL CHECK (category IN
                 ('water','electricity','common_expenses','projects','contracts','fines','other')),
  description  TEXT NOT NULL,
  amount_usd   NUMERIC(12,2) NOT NULL,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  -- record of how it was split (charges below are the materialized result)
  scope_type   TEXT NOT NULL DEFAULT 'block'
               CHECK (scope_type IN ('compound','block','group','units','unit')),
  method       TEXT NOT NULL DEFAULT 'by_shares'
               CHECK (method IN ('equal','by_shares','custom','percentage')),
  invoice_url  TEXT,
  created_by   UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS expenses_building_idx ON expenses(building_id, expense_date DESC);

-- A charge is one unit's slice (from an expense, or a one-off manual charge).
CREATE TABLE IF NOT EXISTS charges (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_id  UUID REFERENCES expenses(id) ON DELETE CASCADE,  -- NULL = manual charge
  unit_id     UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount_usd  NUMERIC(12,2) NOT NULL,
  charge_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS charges_unit_idx ON charges(unit_id);
CREATE INDEX IF NOT EXISTS charges_building_idx ON charges(building_id, charge_date DESC);

-- Payments are recorded against a unit's account (statement-style).
-- Unit balance = SUM(payments) - SUM(charges):  positive = credit, negative = owed.
CREATE TABLE IF NOT EXISTS payments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  unit_id     UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  amount_usd  NUMERIC(12,2) NOT NULL,
  method      TEXT NOT NULL DEFAULT 'cash'
              CHECK (method IN ('cash','bank_transfer','cheque','other')),
  paid_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  note        TEXT,
  recorded_by UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payments_unit_idx ON payments(unit_id);
CREATE INDEX IF NOT EXISTS payments_building_idx ON payments(building_id, paid_on DESC);

-- ============================================================
-- 7. PERMISSION HELPERS  (all SECURITY DEFINER → bypass RLS,
--    so policies that call them never recurse)
-- ============================================================

-- Capability bundle per role. Mirrors src/lib/permissions.ts — keep in sync.
CREATE OR REPLACE FUNCTION role_has_cap(p_role TEXT, p_cap TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_role IN ('building_admin','org_admin') THEN p_cap IN (
      'building.manage','unit.manage','group.manage',
      'resident.approve','resident.manage','grant.manage',
      'issue.view_all','issue.update',
      'expense.manage','charge.manage','payment.record','payment.confirm','finance.view',
      'meeting.manage','org.manage','org.assign_buildings')
    WHEN p_role IN ('building_finance','org_finance') THEN p_cap IN (
      'expense.manage','charge.manage','payment.record','payment.confirm','finance.view')
    WHEN p_role = 'viewer' THEN p_cap IN ('finance.view','issue.view_all')
    ELSE FALSE
  END;
$$;

CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE((SELECT is_platform_admin FROM profiles WHERE id = auth.uid()), FALSE);
$$;

-- THE single permission check. Every management RLS policy routes through this.
CREATE OR REPLACE FUNCTION user_can(p_building UUID, p_cap TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE r TEXT;
BEGIN
  IF is_platform_admin() THEN RETURN TRUE; END IF;
  FOR r IN
    SELECT g.role FROM grants g
    WHERE g.user_id = auth.uid()
      AND (
        (g.scope_type = 'building' AND g.building_id = p_building)
        OR (g.scope_type = 'org' AND EXISTS (
              SELECT 1 FROM org_buildings ob
              WHERE ob.org_id = g.org_id AND ob.building_id = p_building))
      )
  LOOP
    IF role_has_cap(r, p_cap) THEN RETURN TRUE; END IF;
  END LOOP;
  RETURN FALSE;
END;
$$;

-- Units the current user owns/occupies (for resident row-level access).
CREATE OR REPLACE FUNCTION user_unit_ids()
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT unit_id FROM memberships WHERE user_id = auth.uid();
$$;

-- True if the user is a member of any unit in the given building.
CREATE OR REPLACE FUNCTION user_member_building(p_building UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m JOIN units u ON u.id = m.unit_id
    WHERE m.user_id = auth.uid() AND u.building_id = p_building
  );
$$;

-- Building that owns a given unit (definer helper for membership policies).
CREATE OR REPLACE FUNCTION building_of_unit(p_unit UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT building_id FROM units WHERE id = p_unit;
$$;

-- ============================================================
-- 8. ROW LEVEL SECURITY for the new tables
-- ============================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE compounds     ENABLE ROW LEVEL SECURITY;
ALTER TABLE grants        ENABLE ROW LEVEL SECURITY;
ALTER TABLE units         ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships   ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_groups   ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE charges       ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments      ENABLE ROW LEVEL SECURITY;

-- Make this migration safely re-runnable (Postgres has no CREATE POLICY IF NOT EXISTS).
DROP POLICY IF EXISTS orgs_select ON organizations;
DROP POLICY IF EXISTS orgs_write ON organizations;
DROP POLICY IF EXISTS org_buildings_select ON org_buildings;
DROP POLICY IF EXISTS org_buildings_write ON org_buildings;
DROP POLICY IF EXISTS compounds_select ON compounds;
DROP POLICY IF EXISTS compounds_write ON compounds;
DROP POLICY IF EXISTS grants_select ON grants;
DROP POLICY IF EXISTS grants_write ON grants;
DROP POLICY IF EXISTS units_select ON units;
DROP POLICY IF EXISTS units_write ON units;
DROP POLICY IF EXISTS memberships_select ON memberships;
DROP POLICY IF EXISTS memberships_write ON memberships;
DROP POLICY IF EXISTS groups_select ON groups;
DROP POLICY IF EXISTS groups_write ON groups;
DROP POLICY IF EXISTS unit_groups_select ON unit_groups;
DROP POLICY IF EXISTS unit_groups_write ON unit_groups;
DROP POLICY IF EXISTS expenses_select ON expenses;
DROP POLICY IF EXISTS expenses_write ON expenses;
DROP POLICY IF EXISTS charges_select ON charges;
DROP POLICY IF EXISTS charges_write ON charges;
DROP POLICY IF EXISTS payments_select ON payments;
DROP POLICY IF EXISTS payments_write ON payments;

-- ---- ORGANIZATIONS ----
CREATE POLICY orgs_select ON organizations FOR SELECT USING (
  is_platform_admin()
  OR EXISTS (SELECT 1 FROM grants g WHERE g.user_id = auth.uid() AND g.org_id = id)
);
CREATE POLICY orgs_write ON organizations FOR ALL USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- ---- ORG_BUILDINGS ----
CREATE POLICY org_buildings_select ON org_buildings FOR SELECT USING (
  is_platform_admin()
  OR EXISTS (SELECT 1 FROM grants g WHERE g.user_id = auth.uid() AND g.org_id = org_buildings.org_id)
);
CREATE POLICY org_buildings_write ON org_buildings FOR ALL USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- ---- COMPOUNDS ---- (readable by any authenticated user; managed by platform admin)
CREATE POLICY compounds_select ON compounds FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY compounds_write ON compounds FOR ALL USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- ---- GRANTS ----
CREATE POLICY grants_select ON grants FOR SELECT USING (
  user_id = auth.uid()
  OR is_platform_admin()
  OR (scope_type = 'building' AND user_can(building_id, 'grant.manage'))
);
CREATE POLICY grants_write ON grants FOR ALL USING (
  is_platform_admin()
  OR (scope_type = 'building' AND user_can(building_id, 'grant.manage'))
) WITH CHECK (
  is_platform_admin()
  OR (scope_type = 'building' AND user_can(building_id, 'grant.manage'))
);

-- ---- UNITS ----
CREATE POLICY units_select ON units FOR SELECT USING (
  user_can(building_id, 'finance.view')
  OR user_can(building_id, 'building.manage')
  OR user_member_building(building_id)
);
CREATE POLICY units_write ON units FOR ALL USING (user_can(building_id, 'unit.manage'))
  WITH CHECK (user_can(building_id, 'unit.manage'));

-- ---- MEMBERSHIPS ----
CREATE POLICY memberships_select ON memberships FOR SELECT USING (
  user_id = auth.uid()
  OR is_platform_admin()
  OR user_can(building_of_unit(unit_id), 'resident.manage')
);
CREATE POLICY memberships_write ON memberships FOR ALL USING (
  user_can(building_of_unit(unit_id), 'resident.manage')
) WITH CHECK (
  user_can(building_of_unit(unit_id), 'resident.manage')
);

-- ---- GROUPS ----
CREATE POLICY groups_select ON groups FOR SELECT USING (
  user_can(building_id, 'finance.view')
  OR user_can(building_id, 'group.manage')
  OR user_member_building(building_id)
);
CREATE POLICY groups_write ON groups FOR ALL USING (user_can(building_id, 'group.manage'))
  WITH CHECK (user_can(building_id, 'group.manage'));

CREATE POLICY unit_groups_select ON unit_groups FOR SELECT USING (
  user_can(building_of_unit(unit_id), 'group.manage')
  OR user_can(building_of_unit(unit_id), 'finance.view')
  OR unit_id IN (SELECT user_unit_ids())
);
CREATE POLICY unit_groups_write ON unit_groups FOR ALL USING (
  user_can(building_of_unit(unit_id), 'group.manage')
) WITH CHECK (
  user_can(building_of_unit(unit_id), 'group.manage')
);

-- ---- EXPENSES ---- (managers only; not visible to residents)
CREATE POLICY expenses_select ON expenses FOR SELECT USING (user_can(building_id, 'finance.view'));
CREATE POLICY expenses_write ON expenses FOR ALL USING (user_can(building_id, 'expense.manage'))
  WITH CHECK (user_can(building_id, 'expense.manage'));

-- ---- CHARGES ---- (managers see all; owner sees own unit's charges)
CREATE POLICY charges_select ON charges FOR SELECT USING (
  user_can(building_id, 'finance.view')
  OR unit_id IN (SELECT user_unit_ids())
);
CREATE POLICY charges_write ON charges FOR ALL USING (user_can(building_id, 'charge.manage'))
  WITH CHECK (user_can(building_id, 'charge.manage'));

-- ---- PAYMENTS ---- (managers see all; owner sees own unit's payments)
CREATE POLICY payments_select ON payments FOR SELECT USING (
  user_can(building_id, 'finance.view')
  OR unit_id IN (SELECT user_unit_ids())
);
CREATE POLICY payments_write ON payments FOR ALL USING (user_can(building_id, 'payment.record'))
  WITH CHECK (user_can(building_id, 'payment.record'));

-- ============================================================
-- 9. BOOTSTRAP (run manually, replace the email)
-- ============================================================
-- Make yourself a platform admin (full access everywhere):
--   UPDATE profiles SET is_platform_admin = TRUE
--   WHERE id = (SELECT id FROM auth.users WHERE email = 'you@example.com');
--
-- Grant someone building-admin on one building:
--   INSERT INTO grants (user_id, scope_type, building_id, role)
--   VALUES ('<user-uuid>', 'building', '<building-uuid>', 'building_admin');
--
-- Make a unit + assign an owner:
--   INSERT INTO units (building_id, label) VALUES ('<building-uuid>', '4B') RETURNING id;
--   INSERT INTO memberships (user_id, unit_id) VALUES ('<user-uuid>', '<unit-uuid>');
