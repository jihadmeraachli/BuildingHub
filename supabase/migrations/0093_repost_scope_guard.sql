-- ============================================================
-- 0093_repost_scope_guard.sql
-- repost_metered_expense() stops trusting the client's rows (2026-08-06).
--
-- THE HOLE. The function is SECURITY DEFINER, so charges RLS
-- (user_can(building_id,'charge.manage')) does not apply inside it, and 0092
-- inserted unit_id AND building_id verbatim out of p_charges:
--
--     SELECT p_expense, (c->>'unit_id')::UUID, (c->>'building_id')::UUID, …
--
-- The permission check above it validates the EXPENSE's scope only — nothing
-- checked that the units in the payload live in that scope. An admin of one
-- building could call the RPC by hand with another building's unit ids and
-- write charges onto units they do not manage, straight past RLS.
--
-- Not reachable from the UI (it posts what computeMeterCycle derived), and it
-- needs the target unit UUIDs. But it was the one place the new money code took
-- row data from the client instead of computing it in SQL. Compare
-- request_payment_for_expense (0091), which builds its lines from `charges`
-- inside the function — that is the pattern this restores.
--
-- THE FIX, same signature so no client change is needed:
--   · building_id is DERIVED from the unit, never read from the payload
--     (a caller-supplied building_id is now simply ignored)
--   · every unit must belong to the expense's scope — its building, or a block
--     of its compound — checked BEFORE anything is written
--   · a supplied tenant_id must actually be a member of that unit, so a charge
--     cannot be billed to an unrelated person
--
-- Still client-computed BY DESIGN: the amounts. The metering derivation runs in
-- computeMeterCycle and the totals in p_fields/p_charges are its output. That is
-- the module's shape, not a hole — but it is why the SCOPE has to be sealed
-- here: amounts are only as trustworthy as the units they land on.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION repost_metered_expense(p_expense UUID, p_fields JSONB, p_charges JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_e RECORD;
BEGIN
  SELECT * INTO v_e FROM expenses WHERE id = p_expense AND meter_cycle_id IS NOT NULL;
  IF v_e IS NULL THEN
    RAISE EXCEPTION 'Metered expense not found.' USING ERRCODE = '22023';
  END IF;
  IF NOT (is_platform_admin()
          OR (v_e.building_id IS NOT NULL AND user_can(v_e.building_id, 'expense.manage'))
          OR (v_e.compound_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM buildings b WHERE b.compound_id = v_e.compound_id AND user_can(b.id, 'expense.manage')))) THEN
    RAISE EXCEPTION 'Not allowed to re-post this expense.' USING ERRCODE = '42501';
  END IF;

  -- ---- the payload is checked BEFORE a single row moves --------------------
  -- An unknown unit, or one outside this expense's scope, kills the whole call.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_charges) AS c
    LEFT JOIN units     u ON u.id = (c->>'unit_id')::UUID
    LEFT JOIN buildings b ON b.id = u.building_id
    WHERE u.id IS NULL
       OR NOT ((v_e.building_id IS NOT NULL AND u.building_id = v_e.building_id)
            OR (v_e.compound_id IS NOT NULL AND b.compound_id = v_e.compound_id))
  ) THEN
    RAISE EXCEPTION 'A charge targets a unit outside this expense''s building or compound.'
      USING ERRCODE = '42501';
  END IF;

  -- A charge billed to a tenant must name someone who actually holds that unit
  -- (past tenures included — a cycle can be re-posted after a move-out).
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_charges) AS c
    WHERE NULLIF(c->>'tenant_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.unit_id = (c->>'unit_id')::UUID
          AND m.user_id = (c->>'tenant_id')::UUID)
  ) THEN
    RAISE EXCEPTION 'A charge names a tenant who does not hold that unit.'
      USING ERRCODE = '42501';
  END IF;

  -- transaction-local flag: the guard trigger (0092) admits THIS update only
  PERFORM set_config('app.metering_repost', '1', true);

  UPDATE expenses SET
    category        = COALESCE(p_fields->>'category', category),
    expense_type_id = NULLIF(p_fields->>'expense_type_id', '')::UUID,
    description     = COALESCE(p_fields->>'description', description),
    amount_usd      = (p_fields->>'amount_usd')::NUMERIC,
    amount_lbp      = NULLIF(p_fields->>'amount_lbp', '')::NUMERIC,
    lbp_rate        = NULLIF(p_fields->>'lbp_rate', '')::NUMERIC,
    expense_date    = (p_fields->>'expense_date')::DATE
  WHERE id = p_expense;

  DELETE FROM charges WHERE expense_id = p_expense;

  -- building_id comes from the UNIT, not the payload
  INSERT INTO charges (expense_id, unit_id, building_id, category, description, amount_usd, charge_date, billed_to, tenant_id, created_by)
  SELECT p_expense,
         u.id,
         u.building_id,
         c->>'category',
         c->>'description',
         (c->>'amount_usd')::NUMERIC,
         (c->>'charge_date')::DATE,
         c->>'billed_to',
         NULLIF(c->>'tenant_id', '')::UUID,
         auth.uid()
  FROM jsonb_array_elements(p_charges) AS c
  JOIN units u ON u.id = (c->>'unit_id')::UUID;
END;
$$;
GRANT EXECUTE ON FUNCTION repost_metered_expense(UUID, JSONB, JSONB) TO authenticated;

-- ------------------------------------------------------------
-- Note for whoever writes the next migration that touches expenses:
-- the guard_metered_expense trigger (0092) fires on EVERY update to a metered
-- expense, migrations included. A backfill over those rows must run
--     SELECT set_config('app.metering_repost', '1', true);
-- first, in the same transaction, or it will fail with the cycle message.
-- ------------------------------------------------------------
COMMENT ON FUNCTION repost_metered_expense(UUID, JSONB, JSONB) IS
  'Re-posts a metering cycle atomically. Unit scope and tenant identity are enforced here because SECURITY DEFINER bypasses charges RLS; building_id is derived from the unit and any caller-supplied value is ignored.';

COMMIT;

-- ============================================================
-- Post-run checks (wrap in BEGIN … ROLLBACK):
--   Re-post a cycle from the app → unchanged behaviour, charges rebuilt.
--   Hand-call the RPC with a unit id from ANOTHER building in p_charges
--     → 'A charge targets a unit outside this expense''s building or compound.'
--   Hand-call it with the right unit but a random profile id as tenant_id
--     → 'A charge names a tenant who does not hold that unit.'
--   Hand-call it with a bogus building_id but a valid in-scope unit
--     → succeeds, and the stored charge carries the UNIT's building_id.
-- ============================================================
