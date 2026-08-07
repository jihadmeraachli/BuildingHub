-- ============================================================
-- DEMO DATA — owner/tenant split + LBP payments, so the Custom report's
-- Party and Currency filters have something to show.
--
-- ONE-OFF, not a migration. Safe to re-run: it clears what it created first
-- (everything it writes is tagged in the note/description).
--
-- Makes Nadia Salameh's first unit a leased one: Nadim Barakat becomes its
-- tenant, gets his own charges and payments, and both parties pay partly in
-- lira at a frozen rate.
-- ============================================================
BEGIN;

-- Notification triggers OFF: this is backfill, not events. Without it every
-- insert emails and push-notifies the demo inboxes.
ALTER TABLE charges  DISABLE TRIGGER USER;
ALTER TABLE payments DISABLE TRIGGER USER;
ALTER TABLE expenses DISABLE TRIGGER USER;

DO $$
DECLARE
  v_nadia  UUID;
  v_nadim  UUID;
  v_unit   UUID;
  v_bldg   UUID;
  v_label  TEXT;
  v_rate   NUMERIC := 89500;   -- the rate every row below is frozen at
  v_type   UUID;
BEGIN
  SELECT id INTO v_nadia FROM auth.users WHERE lower(email) = 'jihad.meraachli+demoowner@gmail.com';
  SELECT id INTO v_nadim FROM auth.users WHERE lower(email) = 'jihad.meraachli+demo17@gmail.com';
  IF v_nadia IS NULL OR v_nadim IS NULL THEN
    RAISE EXCEPTION 'Demo accounts not found — run seed-demo.mjs first.';
  END IF;

  -- Nadia's first unit, and its block
  SELECT u.id, u.building_id, u.label INTO v_unit, v_bldg, v_label
  FROM memberships m JOIN units u ON u.id = m.unit_id
  WHERE m.user_id = v_nadia AND m.tenure = 'owner' AND m.ended_at IS NULL
  ORDER BY u.label
  LIMIT 1;
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'Nadia owns no unit — check the demo setup.';
  END IF;
  RAISE NOTICE 'Leasing unit % (%)', v_label, v_unit;

  -- ---- idempotency: remove anything a previous run left --------
  DELETE FROM payments WHERE unit_id = v_unit AND note LIKE '[demo-lbp]%';
  DELETE FROM charges  WHERE unit_id = v_unit AND description LIKE '[demo-lbp]%';
  DELETE FROM expenses WHERE building_id = v_bldg AND description LIKE '[demo-lbp]%';

  -- ---- the tenancy ---------------------------------------------
  DELETE FROM membership_invites WHERE user_id = v_nadim;   -- he was a pending invite
  IF NOT EXISTS (SELECT 1 FROM memberships
                 WHERE unit_id = v_unit AND user_id = v_nadim AND ended_at IS NULL) THEN
    INSERT INTO memberships (user_id, unit_id, tenure) VALUES (v_nadim, v_unit, 'tenant');
  END IF;

  -- the building's prefill rate, so new entries default to it
  UPDATE buildings SET lbp_rate = v_rate WHERE id = v_bldg;

  -- ---- a building expense paid partly in lira -------------------
  -- Gives the "Building expenses" scope a MIX row to filter on.
  SELECT id INTO v_type FROM expense_types
   WHERE COALESCE(building_id, compound_id) IS NOT NULL AND key = 'electricity'
     AND (building_id = v_bldg OR compound_id = (SELECT compound_id FROM buildings WHERE id = v_bldg))
   LIMIT 1;
  INSERT INTO expenses (building_id, category, expense_type_id, description,
                        amount_usd, amount_lbp, lbp_rate, expense_date, scope_type, method, created_by)
  VALUES (v_bldg, 'electricity', v_type, '[demo-lbp] Generator diesel, paid part cash part lira',
          450.00, 17900000, v_rate,           -- 17,900,000 / 89,500 = $200 of the $450
          CURRENT_DATE - 21, 'block', 'custom', v_nadia);

  -- ---- the TENANT's charges (his sub-ledger) -------------------
  INSERT INTO charges (unit_id, building_id, category, description, amount_usd, charge_date, billed_to, tenant_id, created_by)
  VALUES
    (v_unit, v_bldg, 'water',       '[demo-lbp] Water share, tenant',       45.00,  CURRENT_DATE - 60, 'tenant', v_nadim, v_nadia),
    (v_unit, v_bldg, 'electricity', '[demo-lbp] Generator share, tenant',   80.00,  CURRENT_DATE - 30, 'tenant', v_nadim, v_nadia),
    (v_unit, v_bldg, 'electricity', '[demo-lbp] Generator share, tenant',   75.00,  CURRENT_DATE - 5,  'tenant', v_nadim, v_nadia);

  -- ---- payments: OWNER (Nadia) ---------------------------------
  -- one straight dollars, one all lira, one split — so the Currency filter
  -- has USD / LBP / MIX to separate.
  INSERT INTO payments (unit_id, building_id, amount_usd, amount_lbp, lbp_rate, method, paid_on, note, paid_by, tenant_id, recorded_by)
  VALUES
    (v_unit, v_bldg, 200.00, NULL,    NULL,   'bank_transfer', CURRENT_DATE - 75, '[demo-lbp] Owner payment, dollars',      'owner', NULL, v_nadia),
    (v_unit, v_bldg, 100.00, 8950000, v_rate, 'cash',          CURRENT_DATE - 45, '[demo-lbp] Owner payment, all lira',      'owner', NULL, v_nadia),
    (v_unit, v_bldg, 150.00, 4475000, v_rate, 'cash',          CURRENT_DATE - 15, '[demo-lbp] Owner payment, dollars + lira','owner', NULL, v_nadia);

  -- ---- payments: TENANT (Nadim) --------------------------------
  INSERT INTO payments (unit_id, building_id, amount_usd, amount_lbp, lbp_rate, method, paid_on, note, paid_by, tenant_id, recorded_by)
  VALUES
    (v_unit, v_bldg,  50.00, 4475000, v_rate, 'cash', CURRENT_DATE - 50, '[demo-lbp] Tenant payment, all lira',       'tenant', v_nadim, v_nadia),
    (v_unit, v_bldg, 120.00, 1790000, v_rate, 'cash', CURRENT_DATE - 20, '[demo-lbp] Tenant payment, dollars + lira', 'tenant', v_nadim, v_nadia);
END $$;

ALTER TABLE charges  ENABLE TRIGGER USER;
ALTER TABLE payments ENABLE TRIGGER USER;
ALTER TABLE expenses ENABLE TRIGGER USER;

-- what landed
SELECT p.paid_on, p.amount_usd, p.amount_lbp, p.lbp_rate, p.paid_by, p.note
FROM payments p JOIN units u ON u.id = p.unit_id
WHERE p.note LIKE '[demo-lbp]%'
ORDER BY p.paid_on;

COMMIT;

-- ============================================================
-- Then, signed in as the demo OWNER persona (/demo → owner):
--   Reports → Custom report
--     · Party = Owner / Tenant   → her rows vs her tenant's
--     · Currency = LBP only      → the two all-lira payments
--     · Currency = Mixed         → the split ones, LL … @ 89,500 under each
--     · Group by = Month         → the three months these span
--
-- Sign in as jihad.meraachli+demo17@gmail.com (Nadim) to see the other half of
-- 0097: the Party filter does not appear at all, because a tenant only ever
-- has tenant rows.
-- ============================================================
