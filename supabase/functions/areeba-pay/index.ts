// ============================================================
// areeba-pay — start a card payment for a licence invoice (Areeba hosted page).
//
// Same contract as whish-pay: the client sends { invoice_id }, gets back a
// { checkoutUrl } to redirect to, and NOTHING here settles anything — only
// areeba-callback does, after verifying with Areeba. The amount is read from
// the invoice server-side; an amount from the browser is an invitation to pay
// $1 for a $200 licence.
//
// ⚠️ INTEGRATION SHELL. Areeba's merchant API (MPGS-based hosted checkout) is
// wired here against the endpoint shape their docs describe, but the account
// is not open yet: until AREEBA_* secrets are set this returns 503, exactly
// like whish-pay before its keys. When the real credentials arrive, verify
// the two endpoint paths below against the onboarding pack and adjust once.
//
// Card storage for auto-renew: the checkout is created with the request to
// tokenize the card; the callback stores the token on the subscription as
// provider_customer_ref. If the account is not enabled for tokenization,
// auto-renew simply stays unavailable — the UI reads provider_customer_ref.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const AREEBA_BASE = Deno.env.get('AREEBA_BASE_URL') ?? '';          // e.g. https://epayment.areeba.com/api/rest/version/72
const AREEBA_MERCHANT = Deno.env.get('AREEBA_MERCHANT_ID') ?? '';
const AREEBA_PASSWORD = Deno.env.get('AREEBA_API_PASSWORD') ?? '';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://app.abniyah.com';
const FN_URL = Deno.env.get('SUPABASE_URL') ?? '';

const areebaAuth = () => 'Basic ' + btoa(`merchant.${AREEBA_MERCHANT}:${AREEBA_PASSWORD}`);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!AREEBA_BASE || !AREEBA_MERCHANT || !AREEBA_PASSWORD) {
      return json({ error: 'Card payments are not configured yet.' }, 503);
    }
    const admin = createClient(FN_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // who is asking, and may they manage this subscription
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!jwt) return json({ error: 'Not signed in.' }, 401);
    const { data: userRes } = await admin.auth.getUser(jwt);
    if (!userRes?.user) return json({ error: 'Not signed in.' }, 401);

    const { invoice_id } = await req.json().catch(() => ({}));
    if (!invoice_id) return json({ error: 'invoice_id is required.' }, 400);
    const { data: inv } = await admin.from('invoices').select('id, amount_cents, status, subscription_id').eq('id', invoice_id).single();
    if (!inv) return json({ error: 'Invoice not found.' }, 404);
    if (inv.status !== 'open') return json({ error: 'This invoice is not open.' }, 409);

    // caller must manage the subscription (same rule as the SQL buttons)
    const caller = createClient(FN_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: allowed } = await caller.rpc('user_manages_subscription', { p_subscription: inv.subscription_id });
    if (!allowed) return json({ error: 'Not allowed.' }, 403);

    // Hosted Checkout session: amount from the invoice, order id = invoice id,
    // and tokenization requested so auto-renew becomes possible.
    const res = await fetch(`${AREEBA_BASE}/merchant/${AREEBA_MERCHANT}/session`, {
      method: 'POST',
      headers: { Authorization: areebaAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiOperation: 'INITIATE_CHECKOUT',
        interaction: {
          operation: 'PURCHASE',
          returnUrl: `${APP_URL}/licenses?paid=${inv.id}`,
          merchant: { name: 'Abniyah' },
        },
        order: { id: inv.id, amount: (inv.amount_cents / 100).toFixed(2), currency: 'USD', description: 'Abniyah licence invoice' },
      }),
    });
    const body = await res.json().catch(() => null);
    const sessionId = body?.session?.id;
    if (!res.ok || !sessionId) {
      console.error('areeba session failed', res.status, JSON.stringify(body).slice(0, 400));
      return json({ error: 'Could not start the card payment.' }, 502);
    }
    await admin.from('invoices').update({ payment_ref: sessionId }).eq('id', inv.id);
    // the hosted payment page for the session
    return json({ checkoutUrl: `${AREEBA_BASE.replace('/api/rest', '')}/checkout/pay/${sessionId}` });
  } catch (err) {
    console.error('areeba-pay', err);
    return json({ error: 'Internal error.' }, 500);
  }
});
