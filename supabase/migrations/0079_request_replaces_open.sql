-- ============================================================
-- 0079_request_replaces_open.sql
-- Issuing a payment request now REPLACES any open one for the same scope.
--
-- 0076 snapshotted the raw balance and left older requests open, so pressing
-- "Request payment" twice created two live obligations for the same money: a
-- unit owing $794 with two open requests showed $1,588 outstanding on the
-- resident card, and each was independently unsettled until that much was paid.
-- Observed on 2026-08-03 with the 1East owner line.
--
-- Ahmad's call: cancel the previous open request and re-ask for the CURRENT
-- balance, with a fresh due date. Resetting the clock is accepted — the
-- trade-off is that a late payer who is re-asked gets their full window again
-- and the daily→weekly escalation restarts, so re-issuing is a deliberate act,
-- not a way to nudge. (Nudging is what the reminders already do on their own.)
--
-- Cancelling is a soft `cancelled_at`, so the history of what was asked and
-- when survives — get_overdue_units, the resident card and the reminder cron
-- all already filter on it.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

DROP FUNCTION IF EXISTS request_payment(TEXT, UUID, TEXT, INT);
CREATE FUNCTION request_payment(
  p_scope_type TEXT,               -- 'building' | 'compound'
  p_scope_id   UUID,
  p_label      TEXT DEFAULT NULL,
  p_due_days   INT  DEFAULT NULL   -- NULL = the entity's payment_due_days
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ids UUID[];
  v_req UUID;
  v_days INT;
BEGIN
  IF p_scope_type = 'building' THEN
    v_ids := ARRAY[p_scope_id];
  ELSIF p_scope_type = 'compound' THEN
    SELECT array_agg(id) INTO v_ids FROM buildings WHERE compound_id = p_scope_id;
  ELSE
    RAISE EXCEPTION 'Unknown scope %', p_scope_type USING ERRCODE = '22023';
  END IF;

  IF v_ids IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(v_ids) id
      WHERE is_platform_admin() OR user_can(id, 'charge.manage')) THEN
    RAISE EXCEPTION 'Not allowed to request payment here.' USING ERRCODE = '42501';
  END IF;

  v_days := COALESCE(p_due_days, effective_due_days(v_ids[1]));

  -- Supersede whatever is still open in this scope. Without this the old ask
  -- and the new one both stand and the resident is billed twice for the same
  -- balance. Soft-cancel keeps the record of what was asked and when.
  UPDATE payment_request_lines l
     SET cancelled_at = now()
   WHERE l.cancelled_at IS NULL
     AND l.building_id = ANY(v_ids);

  INSERT INTO payment_requests (building_id, compound_id, label, due_date, created_by)
  VALUES (
    CASE WHEN p_scope_type = 'building' THEN p_scope_id END,
    CASE WHEN p_scope_type = 'compound' THEN p_scope_id END,
    NULLIF(btrim(COALESCE(p_label, '')), ''),
    CURRENT_DATE + v_days,
    auth.uid())
  RETURNING id INTO v_req;

  -- One line per party actually in arrears, at the CURRENT balance. A leased
  -- unit can owe on both sides, and asking the owner to settle the tenant's
  -- arrears is the bug class 0070 removed everywhere else.
  INSERT INTO payment_request_lines (request_id, unit_id, building_id, party, tenant_id, amount_requested)
  SELECT v_req, u.id, u.building_id, pb.party,
         CASE WHEN pb.party = 'tenant' THEN (
           SELECT m.user_id FROM memberships m
           WHERE m.unit_id = u.id AND m.tenure = 'tenant' AND m.ended_at IS NULL
           ORDER BY m.created_at DESC LIMIT 1) END,
         pb.owed
  FROM units u
  CROSS JOIN LATERAL (
    -- unit_party_balance(unit, party) is signed: negative = owes (0064)
    SELECT 'owner'::TEXT AS party, ROUND(-unit_party_balance(u.id, 'owner'), 2) AS owed
    UNION ALL
    SELECT 'tenant',               ROUND(-unit_party_balance(u.id, 'tenant'), 2)
  ) pb
  WHERE u.building_id = ANY(v_ids) AND pb.owed > 0;

  RETURN v_req;
END;
$$;

GRANT EXECUTE ON FUNCTION request_payment(TEXT, UUID, TEXT, INT) TO authenticated;

-- ------------------------------------------------------------
-- Who can actually be reached for a unit+party. The preview uses it to flag
-- lines that would notify nobody: request_payment bills any unit with a
-- negative balance, whether or not anyone is attached to it, so a debt can be
-- raised that no one is ever asked to pay. Observed on 2026-08-03 with unit
-- 2West ($1,450, no membership at all).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS unit_party_has_recipient(UUID, TEXT);
CREATE FUNCTION unit_party_has_recipient(p_unit UUID, p_party TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.unit_id = p_unit AND m.ended_at IS NULL
      AND m.tenure = CASE WHEN p_party = 'tenant' THEN 'tenant' ELSE 'owner' END
  );
$$;
GRANT EXECUTE ON FUNCTION unit_party_has_recipient(UUID, TEXT) TO authenticated;

COMMIT;

-- ============================================================
-- Post-run checks:
--   1. Issue a request, then issue another for the same building.
--      SELECT count(*) FROM payment_request_lines WHERE cancelled_at IS NULL;
--      -> only the NEW request's lines remain open.
--   2. The resident card shows one obligation per party, not two.
--   3. SELECT unit_party_has_recipient('<2West id>','owner');  -> false
-- ============================================================
