-- ============================================================
-- 0123_contacts_source_of_truth.sql
-- Contacts becomes the registry: Contracts' provider, Inspections'
-- inspector/company, and Projects' contractor all link to it instead of
-- each typing (and re-typing, and mis-typing) the same name. The flow: add
-- the person/company once under Contacts, then pick them everywhere else —
-- which is also what makes a future "how much do we owe company X" report
-- possible (group by contact_id instead of fuzzy-matching free text).
--
-- 1. building_contacts gets `kind` ('local' | 'company') — asked for before
--    the role/title field in the form. Existing rows default to 'local'
--    (a safe, reviewable default; nothing stops an admin re-tagging one to
--    'company' after this runs).
-- 2. service_contracts / inspections / projects each gain a nullable
--    `contact_id`. provider_name (service_contracts) and inspector
--    (inspections) stay as denormalized display text — set FROM the picked
--    contact going forward, left untouched for existing rows that predate
--    this — so nothing that already reads those columns breaks. provider_name
--    drops its NOT NULL: a brand-new contract now requires picking a contact
--    (enforced client-side), not typing a name, so the free-text path a
--    fresh INSERT used to take no longer applies.
-- 3. projects has no equivalent column today — contact_id is the whole field.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE building_contacts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'local'
  CHECK (kind IN ('local', 'company'));
COMMENT ON COLUMN building_contacts.kind IS
  'Local Contact (a person) vs Company — asked before role/title in the form. Purely descriptive; both kinds are equally valid picks anywhere a contact is referenced.';

ALTER TABLE service_contracts ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES building_contacts(id) ON DELETE SET NULL;
ALTER TABLE service_contracts ALTER COLUMN provider_name DROP NOT NULL;
CREATE INDEX IF NOT EXISTS service_contracts_contact_idx ON service_contracts(contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE inspections ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES building_contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS inspections_contact_idx ON inspections(contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES building_contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS projects_contact_idx ON projects(contact_id) WHERE contact_id IS NOT NULL;

COMMIT;

-- Post-run checks:
--   New contract/inspection/project: the provider/inspector/contractor
--     field is a dropdown of building_contacts; saving stamps contact_id
--     (and, for contracts, provider_name from the contact's name).
--   An existing contract with no contact_id: still shows its old
--     provider_name unchanged; editing an unrelated field (e.g. the amount)
--     and saving does not touch provider_name or force a contact pick.
--   ON DELETE SET NULL: deleting a contact does not delete the contract/
--     inspection/project that referenced it — it just goes unlinked, its
--     legacy display text (where one exists) still shows.
