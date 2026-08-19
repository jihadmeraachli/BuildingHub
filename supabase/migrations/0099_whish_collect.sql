-- ============================================================
-- 0099_whish_collect.sql
-- The invoice remembers its Whish payment link (2026-08-07).
--
-- WHY A COLUMN. Whish's externalId must be unique per payment, and their
-- payment link STAYS PAYABLE after a failed attempt — a customer whose OTP
-- went wrong just tries again on the same link. So "Pay with Whish" must
-- RESUME the existing link, not mint a second one. Two links against one
-- invoice would mean two ways to pay it and a real chance of collecting twice.
--
-- externalId is the invoice id itself: already unique, already the thing we
-- want back on a status lookup, and it makes reconciliation a primary-key
-- lookup rather than a search on amount and timestamp.
--
-- collect_status mirrors Whish's own vocabulary (pending / success / failed /
-- refunded / unknown) so the reconcile sweep can find invoices worth asking
-- about without interrogating every invoice ever issued.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS collect_url    TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS collect_status TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS collect_at     TIMESTAMPTZ;

COMMENT ON COLUMN invoices.collect_url IS
  'The Whish hosted payment page for this invoice. Reused on retry — the link stays payable after a failed attempt, and a second link would be a second way to pay the same invoice.';
COMMENT ON COLUMN invoices.collect_status IS
  'Last known Whish collectStatus: pending | success | failed | refunded | unknown. Only success and failed are settled.';

-- The reconcile sweep asks Whish about these and nothing else.
CREATE INDEX IF NOT EXISTS invoices_collect_pending_idx
  ON invoices (collect_at)
  WHERE collect_url IS NOT NULL AND status = 'open';

-- ------------------------------------------------------------
-- The edge function runs on the service key and needs to write these back
-- without being handed blanket UPDATE on invoices. One sealed setter: it can
-- record where a payment got to, and nothing else. Settling still goes through
-- mark_invoice_paid (0098).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS set_invoice_collect(UUID, TEXT, TEXT);
CREATE FUNCTION set_invoice_collect(p_invoice UUID, p_url TEXT, p_status TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_role TEXT := current_setting('request.jwt.claim.role', true);
BEGIN
  IF NOT (is_platform_admin() OR v_role = 'service_role' OR current_user = 'service_role') THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  UPDATE invoices
     SET collect_url    = COALESCE(p_url, collect_url),
         collect_status = COALESCE(p_status, collect_status),
         collect_at     = now()
   WHERE id = p_invoice;
END;
$$;
GRANT EXECUTE ON FUNCTION set_invoice_collect(UUID, TEXT, TEXT) TO service_role;

COMMIT;

-- ============================================================
-- Post-run check:
--   SELECT id, status, collect_status, collect_url FROM invoices LIMIT 5;
-- ============================================================
