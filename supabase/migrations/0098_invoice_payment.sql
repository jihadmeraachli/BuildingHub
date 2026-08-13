-- ============================================================
-- 0098_invoice_payment.sql
-- Paying a licence invoice becomes ONE atomic, idempotent operation
-- (2026-08-07) — the hook a payment gateway can safely call.
--
-- TODAY. PlatformLicensing.markPaid() does three separate calls from the
-- browser: mark the invoice paid, activate the subscription for the period,
-- log the event. Fail between the first two and the invoice reads PAID while
-- the subscription stays INACTIVE — the customer has paid and is still locked
-- out, and nothing on screen explains why. That is the worst failure a
-- licensing flow has, and it is one dropped connection away.
--
-- WHY NOW. Whish Pay (licence payments only — resident dues stay manual, the
-- building just advertises its whish_number) will confirm payment by WEBHOOK.
-- Webhooks RETRY: the same payment will arrive twice, and a second delivery
-- must be a no-op, not a double activation and not an error that makes the
-- gateway retry forever. So the operation has to be idempotent before any
-- integration is wired, and both callers — the platform admin's button and the
-- webhook — must go through the SAME path or they will drift.
--
-- IDEMPOTENCY has two layers:
--   1. Already-paid invoice → returns FALSE, changes nothing, no exception.
--   2. UNIQUE payment_ref → the same gateway transaction cannot be applied to
--      two invoices, even by mistake.
--
-- Additive & idempotent.
-- ============================================================
BEGIN;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_ref    TEXT;
COMMENT ON COLUMN invoices.payment_method IS
  'How it was settled: ''manual'' (a platform admin confirmed a transfer) or a gateway name such as ''whish''.';
COMMENT ON COLUMN invoices.payment_ref IS
  'The gateway''s own transaction id. UNIQUE: one transaction settles one invoice, ever.';

CREATE UNIQUE INDEX IF NOT EXISTS invoices_payment_ref_idx
  ON invoices (payment_ref) WHERE payment_ref IS NOT NULL;

-- ------------------------------------------------------------
-- Returns TRUE when THIS call settled the invoice, FALSE when it was already
-- settled. A webhook can therefore retry safely and still tell the difference
-- between "done" and "done by someone else already".
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS mark_invoice_paid(UUID, TEXT, TEXT);
CREATE FUNCTION mark_invoice_paid(
  p_invoice UUID,
  p_method  TEXT DEFAULT 'manual',
  p_ref     TEXT DEFAULT NULL
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inv  RECORD;
  v_role TEXT := current_setting('request.jwt.claim.role', true);
BEGIN
  -- Two legitimate callers and no others: a platform admin in the app, or an
  -- edge function holding the service key (the gateway webhook). Note this is
  -- NOT "auth.uid() IS NULL" — anon would satisfy that too.
  IF NOT (is_platform_admin()
          OR v_role = 'service_role'
          OR current_user = 'service_role') THEN
    RAISE EXCEPTION 'Not allowed to settle invoices.' USING ERRCODE = '42501';
  END IF;

  -- Lock the row: two webhook deliveries can land at the same moment.
  SELECT * INTO v_inv FROM invoices WHERE id = p_invoice FOR UPDATE;
  IF v_inv IS NULL THEN
    RAISE EXCEPTION 'Invoice not found.' USING ERRCODE = '22023';
  END IF;
  IF v_inv.status = 'void' THEN
    RAISE EXCEPTION 'That invoice was voided — it cannot be settled.' USING ERRCODE = '22023';
  END IF;
  IF v_inv.status = 'paid' THEN
    RETURN FALSE;                       -- already done; a retry, not a failure
  END IF;

  UPDATE invoices
     SET status = 'paid',
         paid_at = now(),
         paid_by = auth.uid(),          -- NULL when the gateway settled it
         payment_method = COALESCE(p_method, 'manual'),
         payment_ref = p_ref
   WHERE id = p_invoice;

  -- The whole point: a paid invoice activates the subscription for the period
  -- it covered. This is the step that used to be a separate round trip.
  UPDATE subscriptions
     SET status = 'active',
         current_period_start = v_inv.period_start,
         current_period_end   = v_inv.period_end
   WHERE id = v_inv.subscription_id;

  INSERT INTO subscription_events (subscription_id, event_type, actor_id, metadata)
  VALUES (v_inv.subscription_id, 'invoice_paid', auth.uid(),
          jsonb_build_object('invoice_id', p_invoice,
                             'amount_cents', v_inv.amount_cents,
                             'method', COALESCE(p_method, 'manual'),
                             'ref', p_ref));

  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION mark_invoice_paid(UUID, TEXT, TEXT) TO authenticated, service_role;

COMMIT;

-- ============================================================
-- Post-run checks:
--   As a platform admin, Mark paid still works and the subscription activates.
--   Call it twice on the same invoice → the second returns FALSE and changes
--   nothing (this is the webhook-retry case).
--   Two invoices with the same payment_ref → rejected by the unique index.
--   A non-platform-admin calling it → 42501.
--
-- For the gateway integration later: the webhook edge function verifies the
-- signature, then calls
--     SELECT mark_invoice_paid('<invoice>', 'whish', '<their txn id>');
-- and returns 200 whether it got TRUE or FALSE — both mean "settled", and a
-- non-200 makes the gateway retry forever.
-- ============================================================
