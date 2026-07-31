-- ============================================================
-- 0057_notification_channel_required.sql
-- At least ONE notification channel (email or WhatsApp) must stay enabled —
-- otherwise reminders and notices can be silently unsubscribed into the void.
-- Backfills anyone who already switched both off (email back on: everyone has
-- an email address by definition; WhatsApp needs a phone), then enforces at
-- the database level. UI mirrors this with a friendly message.
-- Additive & idempotent.
-- ============================================================
BEGIN;

UPDATE profiles SET notify_email = true
WHERE COALESCE(notify_email, false) = false
  AND COALESCE(notify_whatsapp, false) = false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_notification_channel_required'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_notification_channel_required
      CHECK (COALESCE(notify_email, false) OR COALESCE(notify_whatsapp, false));
  END IF;
END $$;

COMMIT;
