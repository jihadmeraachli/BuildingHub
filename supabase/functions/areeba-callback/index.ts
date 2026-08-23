// ============================================================
// areeba-callback — confirm a card payment and settle the licence invoice.
//
// Same discipline as whish-callback: the browser returning "successfully" is
// not evidence of payment. This function asks Areeba for the order status
// server-side and settles only on a captured/successful result, through
// mark_invoice_paid (idempotent). A failure settles nothing; the invoice
// stays open and the customer retries.
//
// Also stores the card token (when tokenization is enabled on the account) on
// the subscription as provider_customer_ref, which is what turns the
// auto-renew toggle on in the UI.
//
// GET  ?invoice=<id>           verify one invoice (the return redirect hits this)
// GET  ?reconcile=1            sweep open card invoices (cron, CRON_SECRET)
//
// ⚠️ INTEGRATION SHELL like areeba-pay: 503 until AREEBA_* secrets exist;
// verify the ORDER endpoint path against the onboarding pack when keys arrive.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const AREEBA_BASE = Deno.env.get('AREEBA_BASE_URL') ?? '';
const AREEBA_MERCHANT = Deno.env.get('AREEBA_MERCHANT_ID') ?? '';
const AREEBA_PASSWORD = Deno.env.get('AREEBA_API_PASSWORD') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const APP_URL = Deno.env.get('APP_URL') ?? 'https://app.abniyah.com';
const FN_URL = Deno.env.get('SUPABASE_URL') ?? '';

const areebaAuth = () => 'Basic ' + btoa(`merchant.${AREEBA_MERCHANT}:${AREEBA_PASSWORD}`);
const db = () => createClient(FN_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Ask Areeba what actually happened to the order (order id = invoice id). */
async function orderResult(invoiceId: string): Promise<{ paid: boolean; token: string | null; ref: string | null }> {
  const res = await fetch(`${AREEBA_BASE}/merchant/${AREEBA_MERCHANT}/order/${invoiceId}`, {
    headers: { Authorization: areebaAuth() },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) return { paid: false, token: null, ref: null };
  const paid = body.result === 'SUCCESS' && ['CAPTURED', 'PAID'].includes(String(body.status ?? '').toUpperCase());
  const token = body?.sourceOfFunds?.token ?? null;
  const ref = body?.transaction?.[0]?.transaction?.id ?? body?.id ?? null;
  return { paid, token, ref };
}

async function settleOne(invoiceId: string): Promise<string> {
  const admin = db();
  const { paid, token, ref } = await orderResult(invoiceId);
  if (!paid) return 'unpaid';
  const { data: settled } = await admin.rpc('mark_invoice_paid', { p_invoice: invoiceId, p_method: 'areeba', p_ref: ref });
  if (token) {
    const { data: inv } = await admin.from('invoices').select('subscription_id').eq('id', invoiceId).single();
    if (inv) await admin.from('subscriptions').update({ provider_customer_ref: token, payment_provider: 'areeba' }).eq('id', inv.subscription_id);
  }
  return settled ? 'settled' : 'already-settled';
}

Deno.serve(async (req) => {
  try {
    if (!AREEBA_BASE || !AREEBA_MERCHANT || !AREEBA_PASSWORD) {
      return json({ error: 'Card payments are not configured yet.' }, 503);
    }
    const url = new URL(req.url);

    if (url.searchParams.get('reconcile') === '1') {
      if (CRON_SECRET && req.headers.get('Authorization') !== `Bearer ${CRON_SECRET}`) return json({ error: 'Unauthorized' }, 401);
      const admin = db();
      const { data: open } = await admin.from('invoices').select('id').eq('status', 'open').not('payment_ref', 'is', null).limit(50);
      const results: Record<string, string> = {};
      for (const inv of open ?? []) results[inv.id] = await settleOne(inv.id);
      return json({ results });
    }

    const invoiceId = url.searchParams.get('invoice');
    if (!invoiceId) return json({ error: 'invoice is required.' }, 400);
    const outcome = await settleOne(invoiceId);
    // the payer lands back on the Licences page either way; it re-reads status
    return Response.redirect(`${APP_URL}/licenses?payment=${outcome}`, 302);
  } catch (err) {
    console.error('areeba-callback', err);
    return json({ error: 'Internal error.' }, 500);
  }
});
