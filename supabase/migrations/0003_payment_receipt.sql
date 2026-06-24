-- ============================================================
-- BuildingHub — payment receipts (ADDITIVE, safe to re-run)
-- Adds an optional attachment URL to payments (expenses already
-- have invoice_url; meetings already have attachment_urls).
-- ============================================================
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_url TEXT;
