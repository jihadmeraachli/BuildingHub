-- ============================================================
-- 0166_amenity_details.sql
-- Amenity identity fields (QA, 30 Aug): Brand, Quantity, Serial #, and a
-- free-text "what is it?" for kind = 'other' (mirrors service_contracts'
-- service_other pattern). All optional, purely additive.
-- ============================================================
BEGIN;

ALTER TABLE amenities ADD COLUMN IF NOT EXISTS brand      TEXT;
ALTER TABLE amenities ADD COLUMN IF NOT EXISTS serial_no  TEXT;
ALTER TABLE amenities ADD COLUMN IF NOT EXISTS quantity   INT
  CHECK (quantity IS NULL OR quantity > 0);
ALTER TABLE amenities ADD COLUMN IF NOT EXISTS kind_other TEXT;

COMMENT ON COLUMN amenities.kind_other IS
  'What "other" is, e.g. "Pressure booster". Shown in place of the kind label when kind = other (0166).';

COMMIT;

-- Post-run check: add an amenity of kind Other with the specify field filled
-- -> its badge shows the typed name, not "Other".
