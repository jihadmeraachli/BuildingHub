-- ============================================================
-- 0177_create_building_empty_address.sql
-- QA sweep 2026-09-06 (org-admin phase): create_building died with the raw
-- "null value in column address violates not-null constraint" whenever the
-- Add Building modal was saved with an empty address - the client sends
-- NULL for blanks and the function inserted it as-is, while the onboarding
-- RPC has always coalesced to ''. Affects every admin type. Same treatment
-- for city; country falls back to Lebanon like the modal default.
-- Function body is the LIVE definition + the one VALUES change.
-- Additive & idempotent.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_building(p_name text, p_address text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text, p_maps_url text DEFAULT NULL::text, p_compound_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_id UUID;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'A building needs a name.' USING ERRCODE = '22023';
  END IF;

  IF NOT (is_platform_admin()
          OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND status = 'active')) THEN
    RAISE EXCEPTION 'Not allowed to create a building.' USING ERRCODE = '42501';
  END IF;

  -- 0131: attaching a block to a compound requires MANAGING it, not just
  -- seeing it (was user_sees_compound — true for any resident).
  IF p_compound_id IS NOT NULL AND NOT user_manages_compound(p_compound_id) THEN
    RAISE EXCEPTION 'Not allowed to add a block to that compound.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO buildings (name, address, city, country, contact_email, contact_phone, maps_url, compound_id, is_active)
  VALUES (btrim(p_name), COALESCE(p_address, ''), COALESCE(p_city, ''), COALESCE(p_country, 'Lebanon'), p_contact_email, p_contact_phone, p_maps_url, p_compound_id, TRUE)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$
;
