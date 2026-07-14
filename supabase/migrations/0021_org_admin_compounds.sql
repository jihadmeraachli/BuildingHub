-- 0021: let org_admins create and manage compounds
-- Additive & idempotent — safe to re-run.

DROP POLICY IF EXISTS "compounds_write_org_admin" ON compounds;
CREATE POLICY "compounds_write_org_admin" ON compounds
  FOR ALL TO authenticated
  USING (
    is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM grants
      WHERE grants.user_id = auth.uid()
        AND grants.scope_type = 'org'
        AND grants.role = 'org_admin'
    )
  )
  WITH CHECK (
    is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM grants
      WHERE grants.user_id = auth.uid()
        AND grants.scope_type = 'org'
        AND grants.role = 'org_admin'
    )
  );
