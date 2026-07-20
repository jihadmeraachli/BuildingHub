-- ============================================================
-- 0031_licensing.sql
-- Subscription licensing module — manual billing, per-unit model.
--
-- Adds:
--   1. subscriptions      — one per entity (building/compound/org), holds license pool
--   2. license_assignments — links individual licenses to units (soft-delete on unassign)
--   3. invoices            — billing records, marked paid manually by platform admin
--   4. subscription_events — full audit log of all license actions
--   5. unit_has_active_license() — enforcement check used by AuthContext
--   6. get_building_subscription() — convenience RPC for Billing UI
--   7. Self-service INSERT policies on buildings/compounds/organizations
--   8. Auto-grant trigger — on entity create, immediately grant user the admin role
--   9. RLS on all new tables
--
-- Additive & idempotent. Transactional.
-- ============================================================
BEGIN;

-- ============================================================
-- 1. SUBSCRIPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope: exactly one of these is set, matching scope_type
  scope_type           TEXT NOT NULL CHECK (scope_type IN ('building','compound','org')),
  building_id          UUID REFERENCES buildings(id)     ON DELETE CASCADE,
  compound_id          UUID REFERENCES compounds(id)     ON DELETE CASCADE,
  org_id               UUID REFERENCES organizations(id) ON DELETE CASCADE,

  -- Plan & billing
  plan                 TEXT NOT NULL DEFAULT 'monthly'
                         CHECK (plan IN ('monthly','annual')),
  status               TEXT NOT NULL DEFAULT 'trial'
                         CHECK (status IN ('trial','active','past_due','cancelled')),

  -- Trial window (populated on creation, cleared on first payment)
  trial_ends_at        TIMESTAMPTZ,

  -- Current billing period (set when status → active)
  current_period_start DATE,
  current_period_end   DATE,

  -- License pool
  license_count        INTEGER NOT NULL DEFAULT 0 CHECK (license_count >= 0),

  -- Pricing: monthly = 500 ($5.00/unit/month), annual = 5000 ($50.00/unit/year)
  price_per_unit_cents INTEGER NOT NULL DEFAULT 500 CHECK (price_per_unit_cents > 0),

  billing_email        TEXT,
  notes                TEXT,
  created_by           UUID REFERENCES profiles(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT subscriptions_scope_chk CHECK (
    (scope_type = 'building' AND building_id IS NOT NULL AND compound_id IS NULL AND org_id IS NULL) OR
    (scope_type = 'compound' AND compound_id IS NOT NULL AND building_id IS NULL AND org_id IS NULL) OR
    (scope_type = 'org'      AND org_id      IS NOT NULL AND building_id IS NULL AND compound_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS subscriptions_building_idx ON subscriptions(building_id);
CREATE INDEX IF NOT EXISTS subscriptions_compound_idx ON subscriptions(compound_id);
CREATE INDEX IF NOT EXISTS subscriptions_org_idx      ON subscriptions(org_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx   ON subscriptions(status);

-- One non-cancelled subscription per scope (prevents duplicate active subs)
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_building_unique_idx
  ON subscriptions(building_id) WHERE building_id IS NOT NULL AND status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_compound_unique_idx
  ON subscriptions(compound_id) WHERE compound_id IS NOT NULL AND status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_org_unique_idx
  ON subscriptions(org_id) WHERE org_id IS NOT NULL AND status <> 'cancelled';

-- ============================================================
-- 2. LICENSE ASSIGNMENTS
--    One row per unit assignment. Unassigning = set unassigned_at (keeps audit).
-- ============================================================
CREATE TABLE IF NOT EXISTS license_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  unit_id         UUID NOT NULL REFERENCES units(id)         ON DELETE CASCADE,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by     UUID REFERENCES profiles(id),
  unassigned_at   TIMESTAMPTZ,
  unassigned_by   UUID REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS license_assignments_sub_idx  ON license_assignments(subscription_id);
CREATE INDEX IF NOT EXISTS license_assignments_unit_idx ON license_assignments(unit_id);

-- A unit may only hold one active (unassigned_at IS NULL) license at a time
CREATE UNIQUE INDEX IF NOT EXISTS license_assignments_unit_active_idx
  ON license_assignments(unit_id) WHERE unassigned_at IS NULL;

-- ============================================================
-- 3. INVOICES
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','paid','void')),
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  paid_at         TIMESTAMPTZ,
  paid_by         UUID REFERENCES profiles(id), -- platform admin who confirmed payment
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoices_subscription_idx ON invoices(subscription_id);
CREATE INDEX IF NOT EXISTS invoices_status_idx       ON invoices(status);

-- ============================================================
-- 4. SUBSCRIPTION EVENTS (audit log)
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  -- event_type values: trial_started | plan_selected | licenses_added |
  --   license_assigned | license_unassigned | invoice_created | invoice_paid |
  --   invoice_voided | subscription_cancelled | trial_extended | status_changed
  event_type      TEXT NOT NULL,
  actor_id        UUID REFERENCES profiles(id),
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_events_sub_idx  ON subscription_events(subscription_id);
CREATE INDEX IF NOT EXISTS subscription_events_type_idx ON subscription_events(event_type);
CREATE INDEX IF NOT EXISTS subscription_events_time_idx ON subscription_events(created_at DESC);

-- ============================================================
-- 5. LICENSE ENFORCEMENT FUNCTION
--    Called by AuthContext after loading memberships.
--    Returns TRUE if unit has an active license (active sub or trial not expired).
-- ============================================================
CREATE OR REPLACE FUNCTION unit_has_active_license(p_unit_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1
    FROM license_assignments la
    JOIN subscriptions s ON s.id = la.subscription_id
    WHERE la.unit_id       = p_unit_id
      AND la.unassigned_at IS NULL
      AND (
        s.status = 'active'
        OR (s.status = 'trial' AND s.trial_ends_at > now())
      )
  );
$$;

-- ============================================================
-- 6. BILLING UI HELPER
--    Returns subscription + live assignment counts for a building.
--    Resolves up the scope chain (building → compound → org).
-- ============================================================
CREATE OR REPLACE FUNCTION get_building_subscription(p_building_id UUID)
RETURNS TABLE (
  id                   UUID,
  scope_type           TEXT,
  status               TEXT,
  plan                 TEXT,
  trial_ends_at        TIMESTAMPTZ,
  current_period_start DATE,
  current_period_end   DATE,
  license_count        INT,
  price_per_unit_cents INT,
  assigned_count       BIGINT,
  available_count      BIGINT
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    s.id,
    s.scope_type,
    s.status,
    s.plan,
    s.trial_ends_at,
    s.current_period_start,
    s.current_period_end,
    s.license_count,
    s.price_per_unit_cents,
    COUNT(la.id) FILTER (WHERE la.unassigned_at IS NULL)                          AS assigned_count,
    GREATEST(0,
      s.license_count
      - COUNT(la.id) FILTER (WHERE la.unassigned_at IS NULL))::BIGINT             AS available_count
  FROM subscriptions s
  LEFT JOIN license_assignments la ON la.subscription_id = s.id
  WHERE s.status <> 'cancelled'
    AND (
      (s.scope_type = 'building' AND s.building_id = p_building_id)
      OR (s.scope_type = 'compound' AND EXISTS (
            SELECT 1 FROM buildings b
            WHERE b.id = p_building_id AND b.compound_id = s.compound_id))
      OR (s.scope_type = 'org' AND EXISTS (
            SELECT 1 FROM org_buildings ob
            WHERE ob.building_id = p_building_id AND ob.org_id = s.org_id))
    )
  GROUP BY s.id
  ORDER BY s.created_at DESC
  LIMIT 1;
$$;

-- ============================================================
-- 7. SELF-SERVICE ENTITY CREATION
--    Any authenticated user with an active profile may create their own
--    building / compound / org. The trigger below immediately grants them
--    the matching admin role so subsequent INSERTs (subscription etc.) pass RLS.
-- ============================================================

CREATE OR REPLACE FUNCTION auto_grant_on_entity_create()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Platform admin creates entities without a self-grant (they already have god-mode).
  -- Edge functions also run with uid()=NULL — skip.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF is_platform_admin() THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'buildings' THEN
    INSERT INTO grants (user_id, scope_type, building_id, role)
    VALUES (auth.uid(), 'building', NEW.id, 'building_admin')
    ON CONFLICT DO NOTHING;

  ELSIF TG_TABLE_NAME = 'compounds' THEN
    INSERT INTO grants (user_id, scope_type, compound_id, role)
    VALUES (auth.uid(), 'compound', NEW.id, 'compound_admin')
    ON CONFLICT DO NOTHING;

  ELSIF TG_TABLE_NAME = 'organizations' THEN
    INSERT INTO grants (user_id, scope_type, org_id, role)
    VALUES (auth.uid(), 'org', NEW.id, 'org_admin')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS buildings_auto_grant_trg     ON buildings;
DROP TRIGGER IF EXISTS compounds_auto_grant_trg     ON compounds;
DROP TRIGGER IF EXISTS organizations_auto_grant_trg ON organizations;

CREATE TRIGGER buildings_auto_grant_trg
  AFTER INSERT ON buildings
  FOR EACH ROW EXECUTE FUNCTION auto_grant_on_entity_create();

CREATE TRIGGER compounds_auto_grant_trg
  AFTER INSERT ON compounds
  FOR EACH ROW EXECUTE FUNCTION auto_grant_on_entity_create();

CREATE TRIGGER organizations_auto_grant_trg
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION auto_grant_on_entity_create();

-- Allow any active authenticated user to create entities (self-service onboarding).
-- The auto-grant trigger fires immediately after, giving them admin before they need it.
DROP POLICY IF EXISTS "buildings_insert_self_service"     ON buildings;
DROP POLICY IF EXISTS "compounds_insert_self_service"     ON compounds;
DROP POLICY IF EXISTS "organizations_insert_self_service" ON organizations;

CREATE POLICY "buildings_insert_self_service" ON buildings
  FOR INSERT TO authenticated
  WITH CHECK (
    is_platform_admin()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status = 'active')
  );

CREATE POLICY "compounds_insert_self_service" ON compounds
  FOR INSERT TO authenticated
  WITH CHECK (
    is_platform_admin()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status = 'active')
  );

CREATE POLICY "organizations_insert_self_service" ON organizations
  FOR INSERT TO authenticated
  WITH CHECK (
    is_platform_admin()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status = 'active')
  );

-- ============================================================
-- 8. RLS ON NEW TABLES
-- ============================================================
ALTER TABLE subscriptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;

-- ── SUBSCRIPTIONS ─────────────────────────────────────────
DROP POLICY IF EXISTS "subscriptions_all_platform_admin" ON subscriptions;
CREATE POLICY "subscriptions_all_platform_admin" ON subscriptions
  FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "subscriptions_read_scope_admin" ON subscriptions;
CREATE POLICY "subscriptions_read_scope_admin" ON subscriptions
  FOR SELECT TO authenticated USING (
    (scope_type = 'building'  AND user_can(building_id,  'finance.view'))
    OR (scope_type = 'compound' AND EXISTS (
          SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
          AND g.scope_type = 'compound' AND g.compound_id = subscriptions.compound_id
          AND g.role IN ('compound_admin','compound_finance','org_admin','org_finance')))
    OR (scope_type = 'org' AND EXISTS (
          SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
          AND g.scope_type = 'org' AND g.org_id = subscriptions.org_id
          AND g.role IN ('org_admin','org_finance')))
  );

DROP POLICY IF EXISTS "subscriptions_insert_scope_admin" ON subscriptions;
CREATE POLICY "subscriptions_insert_scope_admin" ON subscriptions
  FOR INSERT TO authenticated WITH CHECK (
    (scope_type = 'building' AND EXISTS (
          SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
          AND g.scope_type = 'building' AND g.building_id = subscriptions.building_id
          AND g.role = 'building_admin'))
    OR (scope_type = 'compound' AND EXISTS (
          SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
          AND g.scope_type = 'compound' AND g.compound_id = subscriptions.compound_id
          AND g.role = 'compound_admin'))
    OR (scope_type = 'org' AND EXISTS (
          SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
          AND g.scope_type = 'org' AND g.org_id = subscriptions.org_id
          AND g.role = 'org_admin'))
  );

DROP POLICY IF EXISTS "subscriptions_update_scope_admin" ON subscriptions;
CREATE POLICY "subscriptions_update_scope_admin" ON subscriptions
  FOR UPDATE TO authenticated
  USING (
    (scope_type = 'building'  AND user_can(building_id, 'building.manage'))
    OR (scope_type = 'compound' AND EXISTS (
          SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
          AND g.scope_type = 'compound' AND g.compound_id = subscriptions.compound_id
          AND g.role = 'compound_admin'))
    OR (scope_type = 'org' AND EXISTS (
          SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
          AND g.scope_type = 'org' AND g.org_id = subscriptions.org_id
          AND g.role = 'org_admin'))
  );

-- ── LICENSE ASSIGNMENTS ───────────────────────────────────
DROP POLICY IF EXISTS "license_assignments_all_platform_admin" ON license_assignments;
CREATE POLICY "license_assignments_all_platform_admin" ON license_assignments
  FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "license_assignments_read" ON license_assignments;
CREATE POLICY "license_assignments_read" ON license_assignments
  FOR SELECT TO authenticated USING (
    -- Scope admins see all assignments under their subscription
    EXISTS (
      SELECT 1 FROM subscriptions s WHERE s.id = license_assignments.subscription_id
      AND (
        (s.scope_type = 'building'  AND user_can(s.building_id, 'finance.view'))
        OR (s.scope_type = 'compound' AND EXISTS (
              SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
              AND g.scope_type = 'compound' AND g.compound_id = s.compound_id
              AND g.role IN ('compound_admin','compound_finance')))
        OR (s.scope_type = 'org' AND EXISTS (
              SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
              AND g.scope_type = 'org' AND g.org_id = s.org_id
              AND g.role IN ('org_admin','org_finance')))
      )
    )
    -- Residents can see their own unit's assignment (for "no license" UX)
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.unit_id = license_assignments.unit_id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "license_assignments_insert" ON license_assignments;
CREATE POLICY "license_assignments_insert" ON license_assignments
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM subscriptions s WHERE s.id = license_assignments.subscription_id
      AND (
        (s.scope_type = 'building'  AND user_can(s.building_id, 'building.manage'))
        OR (s.scope_type = 'compound' AND EXISTS (
              SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
              AND g.scope_type = 'compound' AND g.compound_id = s.compound_id
              AND g.role = 'compound_admin'))
        OR (s.scope_type = 'org' AND EXISTS (
              SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
              AND g.scope_type = 'org' AND g.org_id = s.org_id
              AND g.role = 'org_admin'))
      )
    )
  );

DROP POLICY IF EXISTS "license_assignments_update" ON license_assignments;
CREATE POLICY "license_assignments_update" ON license_assignments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM subscriptions s WHERE s.id = license_assignments.subscription_id
      AND (
        (s.scope_type = 'building'  AND user_can(s.building_id, 'building.manage'))
        OR (s.scope_type = 'compound' AND EXISTS (
              SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
              AND g.scope_type = 'compound' AND g.compound_id = s.compound_id
              AND g.role = 'compound_admin'))
        OR (s.scope_type = 'org' AND EXISTS (
              SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
              AND g.scope_type = 'org' AND g.org_id = s.org_id
              AND g.role = 'org_admin'))
      )
    )
  );

-- ── INVOICES ──────────────────────────────────────────────
DROP POLICY IF EXISTS "invoices_all_platform_admin" ON invoices;
CREATE POLICY "invoices_all_platform_admin" ON invoices
  FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "invoices_read_scope_admin" ON invoices;
CREATE POLICY "invoices_read_scope_admin" ON invoices
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM subscriptions s WHERE s.id = invoices.subscription_id
      AND (
        (s.scope_type = 'building'  AND user_can(s.building_id, 'finance.view'))
        OR (s.scope_type = 'compound' AND EXISTS (
              SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
              AND g.scope_type = 'compound' AND g.compound_id = s.compound_id
              AND g.role IN ('compound_admin','compound_finance')))
        OR (s.scope_type = 'org' AND EXISTS (
              SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
              AND g.scope_type = 'org' AND g.org_id = s.org_id
              AND g.role IN ('org_admin','org_finance')))
      )
    )
  );

-- ── SUBSCRIPTION EVENTS ───────────────────────────────────
DROP POLICY IF EXISTS "subscription_events_all_platform_admin" ON subscription_events;
CREATE POLICY "subscription_events_all_platform_admin" ON subscription_events
  FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());

DROP POLICY IF EXISTS "subscription_events_read" ON subscription_events;
CREATE POLICY "subscription_events_read" ON subscription_events
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM subscriptions s WHERE s.id = subscription_events.subscription_id
      AND (
        (s.scope_type = 'building'  AND user_can(s.building_id, 'building.manage'))
        OR (s.scope_type = 'compound' AND EXISTS (
              SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
              AND g.scope_type = 'compound' AND g.compound_id = s.compound_id
              AND g.role IN ('compound_admin','org_admin')))
        OR (s.scope_type = 'org' AND EXISTS (
              SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
              AND g.scope_type = 'org' AND g.org_id = s.org_id
              AND g.role = 'org_admin'))
      )
    )
  );

DROP POLICY IF EXISTS "subscription_events_insert" ON subscription_events;
CREATE POLICY "subscription_events_insert" ON subscription_events
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM subscriptions s WHERE s.id = subscription_events.subscription_id
      AND (
        (s.scope_type = 'building'  AND user_can(s.building_id, 'building.manage'))
        OR (s.scope_type = 'compound' AND EXISTS (
              SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
              AND g.scope_type = 'compound' AND g.compound_id = s.compound_id
              AND g.role IN ('compound_admin','org_admin')))
        OR (s.scope_type = 'org' AND EXISTS (
              SELECT 1 FROM grants g WHERE g.user_id = auth.uid()
              AND g.scope_type = 'org' AND g.org_id = s.org_id
              AND g.role = 'org_admin'))
      )
    )
  );

COMMIT;

-- ============================================================
-- Post-run sanity checks (run separately, read-only):
--
--   -- 1. Tables exist with expected columns:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   AND table_name IN ('subscriptions','license_assignments','invoices','subscription_events');
--
--   -- 2. Unique indexes are in place:
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'license_assignments' AND indexname LIKE '%active%';
--
--   -- 3. Trigger exists on all three entity tables:
--   SELECT trigger_name, event_object_table FROM information_schema.triggers
--   WHERE trigger_name LIKE '%auto_grant%';
--
--   -- 4. Enforcement function works:
--   SELECT unit_has_active_license('<any-unit-uuid>');
--   -- expect: false (no assignments yet)
-- ============================================================
