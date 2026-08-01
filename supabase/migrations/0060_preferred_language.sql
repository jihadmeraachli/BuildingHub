-- ============================================================
-- 0060_preferred_language.sql
-- Per-user language (#44): the app loads in the user's chosen language on
-- every device, and WhatsApp notifications are sent in that language once
-- the per-language templates are approved (WHATSAPP_PER_LANG flag).
--
-- NULL = no explicit choice yet: the app keeps the device/localStorage
-- behavior, and messages default to English.
--
-- Self-service is safe as-is: the 0029 guard trigger blocks specific
-- privilege columns (not a whitelist), so users may set their own language.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS preferred_language TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_preferred_language_check'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_preferred_language_check
      CHECK (preferred_language IS NULL OR preferred_language IN ('en', 'ar'));
  END IF;
END $$;

COMMENT ON COLUMN profiles.preferred_language IS
  'UI + notification language: en | ar | NULL (no explicit choice; device default, English messages).';

COMMIT;

-- Post-run check: SELECT preferred_language, count(*) FROM profiles GROUP BY 1;
