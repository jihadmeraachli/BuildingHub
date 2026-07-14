-- 0022: scope compounds to orgs so org admins only see their own compounds
-- Additive & idempotent — safe to re-run.

ALTER TABLE compounds ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- Org admins can only read compounds belonging to their org (or created by platform admin = null).
-- Platform admins see all. Regular users (residents, building admins) only need compound names
-- for display — they reach those through their building's compound_id, not this list.
DROP POLICY IF EXISTS "compounds_read_scoped" ON compounds;
CREATE POLICY "compounds_read_scoped" ON compounds FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR org_id IS NULL
    OR EXISTS (
      SELECT 1 FROM grants
      WHERE grants.user_id = auth.uid()
        AND grants.scope_type = 'org'
        AND grants.role = 'org_admin'
        AND grants.org_id = compounds.org_id
    )
  );

-- Tighten write policy: org admins can only write compounds for their own org.
DROP POLICY IF EXISTS "compounds_write_org_admin" ON compounds;
CREATE POLICY "compounds_write_org_admin" ON compounds FOR ALL TO authenticated
  USING (
    is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM grants
      WHERE grants.user_id = auth.uid()
        AND grants.scope_type = 'org'
        AND grants.role = 'org_admin'
        AND grants.org_id = compounds.org_id
    )
  )
  WITH CHECK (
    is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM grants
      WHERE grants.user_id = auth.uid()
        AND grants.scope_type = 'org'
        AND grants.role = 'org_admin'
        AND grants.org_id = compounds.org_id
    )
  );
