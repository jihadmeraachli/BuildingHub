// ============================================================
// areeba-callback — confirm a card payment and settle the PAYMENT INTENT.
//
// PAY-FIRST (0117): settling the intent CREATES the invoice already paid (the
// receipt) and applies the effect, via settle_payment_intent(). Same
// discipline as whish-callback: the browser returning "successfully" is not
// evidence of payment. This function asks Areeba for the order status
// server-side (order id = intent id) and settles only on a captured result.
// A failure settles nothing; the customer simply retries.
//
// Also stores the card token (when tokenization is enabled on the account) on
// the subscription as provider_customer_ref, which is what turns the
// auto-renew toggle on in the UI.
//
// GET  ?intent=<id>            verify one intent (the return redirect hits this)
// GET  ?reconcile=1            sweep pending card intents (cron, CRON_SECRET)
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

/** Ask Areeba what actually happened to the order (order id = intent id). */
async function orderResult(intentId: string): Promise<{ paid: boolean; token: string | null; ref: string | null }> {
  const res = await fetch(`${AREEBA_BASE}/merchant/${AREEBA_MERCHANT}/order/${intentId}`, {
    headers: { Authorization: areebaAuth() },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) return { paid: false, token: null, ref: null };
  const paid = body.result === 'SUCCESS' && ['CAPTURED', 'PAID'].includes(String(body.status ?? '').toUpperCase());
  const token = body?.sourceOfFunds?.token ?? null;
  const ref = body?.transaction?.[0]?.transaction?.id ?? body?.id ?? null;
  return { paid, token, ref };
}

async function settleOne(intentId: string): Promise<string> {
  const admin = db();
  const { paid, token, ref } = await orderResult(intentId);
  if (!paid) return 'unpaid';
  const { error } = await admin.rpc('settle_payment_intent', { p_intent: intentId, p_method: 'areeba', p_ref: ref ?? intentId });
  if (error) {
    console.error('settle_payment_intent failed', intentId, error.message);
    return 'error';
  }
  if (token) {
    const { data: intent } = await admin.from('payment_intents').select('subscription_id').eq('id', intentId).single();
    if (intent) await admin.from('subscriptions').update({ provider_customer_ref: token, payment_provider: 'areeba' }).eq('id', intent.subscription_id);
  }
  return 'settled';
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
      const { data: pending } = await admin.from('payment_intents').select('id').eq('status', 'pending').eq('provider', 'areeba').limit(50);
      const results: Record<string, string> = {};
      for (const row of pending ?? []) results[row.id] = await settleOne(row.id);
      return json({ results });
    }

    const intentId = url.searchParams.get('intent');
    if (!intentId) return json({ error: 'intent is required.' }, 400);
    const outcome = await settleOne(intentId);
    // the payer lands back on the Licences page either way; it re-reads status
    return Response.redirect(`${APP_URL}/licenses?payment=${outcome}`, 302);
  } catch (err) {
    console.error('areeba-callback', err);
    return json({ error: 'Internal error.' }, 500);
  }
});
