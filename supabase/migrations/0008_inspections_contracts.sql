-- ============================================================
-- BuildingHub — Inspections + Service Contracts (ADDITIVE, re-runnable)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---- INSPECTIONS (generator, elevator, fire safety, …) ----
CREATE TABLE IF NOT EXISTS inspections (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  building_id     UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  category        TEXT NOT NULL CHECK (category IN
                    ('generator','elevator','fire_safety','water_tank','electrical','hvac','other')),
  title           TEXT NOT NULL,
  inspector       TEXT,
  inspection_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('passed','failed','action_required','pending')),
  outcome         TEXT,
  next_due_date   DATE,
  attachment_url  TEXT,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS inspections_building_idx ON inspections(building_id, inspection_date DESC);

-- ---- SERVICE CONTRACTS (elevators, generators, landscape, security, …) ----
CREATE TABLE IF NOT EXISTS service_contracts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  building_id    UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  service        TEXT NOT NULL CHECK (service IN
                   ('elevator','generator','landscape','security','cleaning','water','internet','other')),
  provider_name  TEXT NOT NULL,
  contact_name   TEXT,
  contact_phone  TEXT,
  start_date     DATE,
  end_date       DATE,
  amount_usd     NUMERIC(12,2),
  billing_cycle  TEXT CHECK (billing_cycle IN ('monthly','quarterly','yearly','one_time')),
  notes          TEXT,
  attachment_url TEXT,
  created_by     UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS contracts_building_idx ON service_contracts(building_id);

-- ---- RLS ----
ALTER TABLE inspections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inspections_select ON inspections;
DROP POLICY IF EXISTS inspections_write ON inspections;
DROP POLICY IF EXISTS contracts_select ON service_contracts;
DROP POLICY IF EXISTS contracts_write ON service_contracts;

-- Inspections: residents in the building can view outcomes; managers manage.
CREATE POLICY inspections_select ON inspections FOR SELECT USING (
  user_can(building_id, 'finance.view')
  OR user_can(building_id, 'building.manage')
  OR user_member_building(building_id)
);
CREATE POLICY inspections_write ON inspections FOR ALL
  USING (user_can(building_id, 'building.manage'))
  WITH CHECK (user_can(building_id, 'building.manage'));

-- Service contracts: managers / finance only.
CREATE POLICY contracts_select ON service_contracts FOR SELECT USING (
  user_can(building_id, 'finance.view') OR user_can(building_id, 'building.manage')
);
CREATE POLICY contracts_write ON service_contracts FOR ALL
  USING (user_can(building_id, 'building.manage'))
  WITH CHECK (user_can(building_id, 'building.manage'));
