-- ============================================================
-- BuildingHub — online meetings (ADDITIVE, safe to re-run)
-- Optional video-call link (Zoom / Teams / etc.) for a meeting.
-- ============================================================
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS meeting_url TEXT;
