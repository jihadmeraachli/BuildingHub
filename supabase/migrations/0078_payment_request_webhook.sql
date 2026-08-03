-- ============================================================
-- 0078_payment_request_webhook.sql
-- Database Webhook for payment requests → dynamic-action (email + WhatsApp).
--
-- Supabase moved the Webhooks page (Database → Webhooks became
-- Integrations → Database Webhooks), so here it is as SQL instead. A
-- "Database Webhook" is nothing more than a trigger calling
-- supabase_functions.http_request() — exactly what the UI generates. Same
-- shape as 0017, which did this for dues.
--
-- The in-app bell does NOT need this (that is the trigger in 0077); this is
-- only what makes the EMAIL and WhatsApp go out when a request is issued.
--
-- BEFORE RUNNING: replace <ANON_KEY> below with the project's anon public key.
--   Dashboard → Project Settings → API → "anon public"
--   (the same value as VITE_SUPABASE_ANON_KEY in .env.local)
-- The anon key is public-safe — it is what the UI puts here too.
--
-- INSERT only: a request is issued once. Edits and cancellations do not notify.
-- Safe to re-run.
-- ============================================================

DROP TRIGGER IF EXISTS notify_payment_request_insert ON public.payment_request_lines;
CREATE TRIGGER notify_payment_request_insert
AFTER INSERT ON public.payment_request_lines
FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(
  'https://miyrsnlpftybmudiuhbi.supabase.co/functions/v1/dynamic-action',
  'POST',
  '{"Content-Type":"application/json","Authorization":"Bearer <ANON_KEY>"}',
  '{}',
  '5000'
);

-- ============================================================
-- Verify it exists:
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.payment_request_lines'::regclass AND NOT tgisinternal;
--   -- expect: trg_notify_payment_request (the bell, 0077)
--   --         notify_payment_request_insert (this webhook)
--
-- Then issue a request and check Edge Functions → dynamic-action → Logs.
-- No log line at all = the webhook did not fire (wrong key or trigger missing).
-- A log line but no email = look at the recipient's notify_email / channels.
-- ============================================================
