-- ============================================================
-- BuildingHub — Database Webhooks for DUES → dynamic-action (email)
-- Same mechanism the dashboard "Webhooks" UI generates.
--
-- BEFORE RUNNING: replace  <ANON_KEY>  below (3 times) with your
-- project's anon public key:
--   Dashboard → Project Settings → API → "anon public"
--   (it's also VITE_SUPABASE_ANON_KEY in your .env.local)
--
-- The in-app bell does NOT need this (it's a DB trigger from 0015);
-- this only enables the EMAILs for dues issue / edit / delete.
-- Safe to re-run.
-- ============================================================

DROP TRIGGER IF EXISTS notify_dues_insert ON public.dues;
CREATE TRIGGER notify_dues_insert
AFTER INSERT ON public.dues
FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(
  'https://miyrsnlpftybmudiuhbi.supabase.co/functions/v1/dynamic-action',
  'POST',
  '{"Content-Type":"application/json","Authorization":"Bearer <anon>"}',
  '{}',
  '5000'
);

DROP TRIGGER IF EXISTS notify_dues_update ON public.dues;
CREATE TRIGGER notify_dues_update
AFTER UPDATE ON public.dues
FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(
  'https://miyrsnlpftybmudiuhbi.supabase.co/functions/v1/dynamic-action',
  'POST',
  '{"Content-Type":"application/json","Authorization":"Bearer <anon>"}',
  '{}',
  '5000'
);

DROP TRIGGER IF EXISTS notify_dues_delete ON public.dues;
CREATE TRIGGER notify_dues_delete
AFTER DELETE ON public.dues
FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(
  'https://miyrsnlpftybmudiuhbi.supabase.co/functions/v1/dynamic-action',
  'POST',
  '{"Content-Type":"application/json","Authorization":"Bearer <anon>"}',
  '{}',
  '5000'
);
