-- ============================================================
-- 0035_import_batches.sql
-- Make bulk money import SAFE: idempotency + one-click reversal.
--
-- The AI import writes expenses / charges / payments in bulk. Two dangers:
--   * Re-running the same file (or a double-click) silently DOUBLES balances —
--     nothing keyed on "already imported".
--   * If an import is wrong, there was no way to undo it.
--
-- This adds an import_batches ledger. Every import is one batch:
--   * content_hash (SHA-256 of the file) lets the client detect a duplicate
--     BEFORE writing and warn.
--   * every row it creates is tagged import_batch_id.
--   * reverse_import_batch() deletes exactly that batch's rows in one shot
--     (expenses cascade to their charges), and marks the batch reversed — the
--     batch row stays as the audit record that it happened and was undone.
--
-- Additive & idempotent. Transactional.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS import_batches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- scope this import targeted (a compound, or a single building)
  scope_type   TEXT NOT NULL CHECK (scope_type IN ('building','compound')),
  building_id  UUID REFERENCES buildings(id) ON DELETE CASCADE,
  compound_id  UUID REFERENCES compounds(id) ON DELETE CASCADE,
  source       TEXT NOT NULL DEFAULT 'ai_expense_import',
  file_name    TEXT,
  content_hash TEXT,                       -- SHA-256 of the uploaded file
  n_expenses   INTEGER NOT NULL DEFAULT 0,
  n_charges    INTEGER NOT NULL DEFAULT 0,
  n_payments   INTEGER NOT NULL DEFAULT 0,
  created_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at  TIMESTAMPTZ,
  reversed_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT import_batches_scope_chk CHECK (
    (scope_type = 'building' AND building_id IS NOT NULL AND compound_id IS NULL) OR
    (scope_type = 'compound' AND compound_id IS NOT NULL AND building_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS import_batches_hash_idx ON import_batches(content_hash) WHERE reversed_at IS NULL;

-- tag rows with the batch that created them (SET NULL so a batch row can be
-- kept even if you ever purge; reversal deletes the rows explicitly anyway)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL;
ALTER TABLE charges  ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- RLS: managers of the scope can see/create batches. Uses the first block of a
-- compound to resolve the capability (all blocks share the compound admin).
-- ------------------------------------------------------------
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION import_batch_building(p_batch import_batches)
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT COALESCE(p_batch.building_id,
                  (SELECT id FROM buildings WHERE compound_id = p_batch.compound_id ORDER BY name LIMIT 1));
$$;

DROP POLICY IF EXISTS import_batches_select ON import_batches;
CREATE POLICY import_batches_select ON import_batches FOR SELECT
  USING (user_can(import_batch_building(import_batches), 'finance.view'));

DROP POLICY IF EXISTS import_batches_write ON import_batches;
CREATE POLICY import_batches_write ON import_batches FOR ALL
  USING (user_can(import_batch_building(import_batches), 'charge.manage'))
  WITH CHECK (user_can(import_batch_building(import_batches), 'charge.manage'));

-- ------------------------------------------------------------
-- Reverse a batch: delete exactly the rows it created, in one transaction.
-- Deleting an expense cascades to its charges (0002); direct unit charges and
-- payments are deleted by tag. The batch row stays, marked reversed.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION reverse_import_batch(p_batch UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE b import_batches;
BEGIN
  SELECT * INTO b FROM import_batches WHERE id = p_batch;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'Import batch not found.' USING ERRCODE = '42501';
  END IF;
  IF b.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This import was already reversed.' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT user_can(import_batch_building(b), 'charge.manage') THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM payments WHERE import_batch_id = p_batch;
  DELETE FROM charges  WHERE import_batch_id = p_batch;  -- direct unit charges
  DELETE FROM expenses WHERE import_batch_id = p_batch;  -- cascades to its charges

  UPDATE import_batches SET reversed_at = now(), reversed_by = auth.uid() WHERE id = p_batch;
END;
$$;

GRANT EXECUTE ON FUNCTION reverse_import_batch(UUID) TO authenticated;

COMMIT;

-- ------------------------------------------------------------
-- Post-run checks (read-only):
--   SELECT file_name, n_expenses, n_charges, n_payments, created_at, reversed_at
--   FROM import_batches ORDER BY created_at DESC;
-- ------------------------------------------------------------
