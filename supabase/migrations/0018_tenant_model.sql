-- 0018_tenant_model.sql
-- Activates the owner/tenant split on memberships and adds billed_to routing on charges.
-- Safe to re-run (idempotent).

-- 1. Ensure every existing membership has a tenure value (backfill NULLs → 'owner')
ALTER TABLE memberships ALTER COLUMN tenure SET DEFAULT 'owner';
UPDATE memberships SET tenure = 'owner' WHERE tenure IS NULL;
ALTER TABLE memberships ALTER COLUMN tenure SET NOT NULL;

-- 2. Add billed_to on charges so expenses can target owners, tenants, or all members.
--    Default 'both' keeps all existing charges visible to whoever is on the unit.
ALTER TABLE charges ADD COLUMN IF NOT EXISTS billed_to text NOT NULL DEFAULT 'both';
ALTER TABLE charges DROP CONSTRAINT IF EXISTS charges_billed_to_check;
ALTER TABLE charges ADD CONSTRAINT charges_billed_to_check CHECK (billed_to IN ('owner', 'tenant', 'both'));
