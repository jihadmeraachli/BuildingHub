-- ============================================================
-- 0124_contacts_email_description.sql
-- building_contacts gains email and description — same optional-text
-- convention as name/phone (NOT NULL DEFAULT '').
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE building_contacts ADD COLUMN IF NOT EXISTS email       TEXT NOT NULL DEFAULT '';
ALTER TABLE building_contacts ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

COMMIT;

-- Post-run check: existing contacts keep working (both columns default to
-- ''); the edit modal now has Email and Description fields under Phone.
