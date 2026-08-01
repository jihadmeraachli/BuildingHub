-- ============================================================
-- 0059_whish_account.sql
-- Manual Whish payment flow (interim until the Whish API integration).
--
-- Each building can register its Whish account (a mobile number). When
-- residents are told they owe money (charge emails, payment reminders, the
-- resident statement), the message adds "you can pay directly through Whish
-- to <number>". The finance user sees the transfer land on the Whish app and
-- records the payment in Abniyah as today.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE buildings ADD COLUMN IF NOT EXISTS whish_number TEXT;

COMMENT ON COLUMN buildings.whish_number IS
  'Whish account (mobile number) residents can transfer dues to. NULL = not offered. Shown in charge/reminder notifications and the resident statement.';

COMMIT;

-- Post-run check: SELECT name, whish_number FROM buildings LIMIT 5;
