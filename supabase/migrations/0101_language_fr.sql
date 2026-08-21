-- ============================================================
-- 0101_language_fr.sql
-- French joins English and Arabic (2026-08-21).
--
-- WHY. It is the one competitor feature worth taking seriously: Binayati ships
-- French and we do not. A large slice of Lebanese syndics, notaries and older
-- committee members work in French, and for them its absence is disqualifying
-- before the demo starts. It is also the cheapest of our three known gaps to
-- close — payments need Whish, proof needs customers and time, French needs a
-- file — and unlike Arabic it is left-to-right, so none of the RTL work repeats.
--
-- 0060 added profiles.preferred_language with a CHECK listing ('en','ar'). A
-- French user saving their choice would be rejected by the database, so the
-- constraint has to widen before the UI can offer it.
--
-- preferred_language is not decoration: notifications and the weekly reminder
-- emails are sent in each person's own language, so this column decides what
-- language a resident is written to in.
--
-- ⚠️ Mirrored by src/lib/languages.ts. A fourth language means editing both.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_preferred_language_check;
ALTER TABLE profiles ADD  CONSTRAINT profiles_preferred_language_check
  CHECK (preferred_language IS NULL OR preferred_language IN ('en', 'ar', 'fr'));

COMMENT ON COLUMN profiles.preferred_language IS
  'UI and notification language: en | ar | fr. NULL = no explicit choice, follow the device. Mirrored by src/lib/languages.ts.';

COMMIT;

-- ============================================================
-- Post-run checks:
--   UPDATE profiles SET preferred_language = 'fr' WHERE id = auth.uid();  -- accepted
--   UPDATE profiles SET preferred_language = 'de' WHERE id = auth.uid();  -- rejected
--
-- Still to do on the sending side: dynamic-action and send-reminders choose an
-- email template by language. Until they carry French templates, a French user
-- receives the English one, which is the correct fallback but is not French.
-- ============================================================
