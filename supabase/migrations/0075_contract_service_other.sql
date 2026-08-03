-- ============================================================
-- 0075_contract_service_other.sql
-- Contracts polish (#51 follow-up, Jey):
--   1. service gains a proper 'maintenance' category.
--   2. When service = 'other', the admin names it (service_other) - the card
--      and the Contacts page then show that name instead of a generic "Other".
-- Status (active/expiring/expired) needs no schema: it derives from end_date
-- in the client, so a contract flips to expired by itself when its end date
-- passes without a renewal.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE service_contracts ADD COLUMN IF NOT EXISTS service_other TEXT;

ALTER TABLE service_contracts DROP CONSTRAINT IF EXISTS service_contracts_service_check;
ALTER TABLE service_contracts ADD CONSTRAINT service_contracts_service_check
  CHECK (service IN ('elevator','generator','landscape','security','cleaning','water','internet','maintenance','other'));

COMMIT;

-- Post-run checks:
--   1. INSERT a contract with service='maintenance' -> ok.
--   2. INSERT with service='nonsense' -> constraint violation.
