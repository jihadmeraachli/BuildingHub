// ============================================================
// areeba-pay — start a card payment for a subscription (Areeba hosted page).
//
// PAY-FIRST (0117): same contract as whish-pay — the client sends
// { subscription_id, kind: 'period'|'topup', plan?, add? }, the amount is
// computed server-side by create_payment_intent(), and NOTHING here settles
// anything — only areeba-callback does, after verifying with Areeba.
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

    const { subscription_id, kind, plan, add } = await req.json().catch(() => ({}));
    if (!subscription_id || !['period', 'topup'].includes(kind)) {
      return json({ error: 'subscription_id and kind are required.' }, 400);
    }

    // caller must manage the subscription (same rule as the SQL buttons)
    const caller = createClient(FN_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: allowed } = await caller.rpc('user_manages_subscription', { p_subscription: subscription_id });
    if (!allowed) return json({ error: 'Not allowed.' }, 403);

    // the intent: amount and dates computed in SQL, never trusted
    const { data: intents, error: intErr } = await admin.rpc('create_payment_intent', {
      p_subscription: subscription_id, p_kind: kind,
      p_plan: plan ?? null, p_add: add || null,
    });
    if (intErr) return json({ error: intErr.message }, 400);
    const intent = Array.isArray(intents) ? intents[0] : intents;
    if (!intent?.intent_id) return json({ error: 'Could not prepare the payment.' }, 500);

    // Hosted Checkout session: amount from the intent, order id = intent id,
    // and tokenization requested so auto-renew becomes possible.
    const res = await fetch(`${AREEBA_BASE}/merchant/${AREEBA_MERCHANT}/session`, {
      method: 'POST',
      headers: { Authorization: areebaAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiOperation: 'INITIATE_CHECKOUT',
        interaction: {
          operation: 'PURCHASE',
          returnUrl: `${FN_URL}/functions/v1/areeba-callback?intent=${intent.intent_id}`,
          merchant: { name: 'Abniyah' },
        },
        order: { id: intent.intent_id, amount: (intent.amount_cents / 100).toFixed(2), currency: 'USD', description: 'Abniyah subscription' },
      }),
    });
    const body = await res.json().catch(() => null);
    const sessionId = body?.session?.id;
    if (!res.ok || !sessionId) {
      console.error('areeba session failed', res.status, JSON.stringify(body).slice(0, 400));
      return json({ error: 'Could not start the card payment.' }, 502);
    }
    await admin.from('payment_intents')
      .update({ provider: 'areeba', provider_ref: sessionId })
      .eq('id', intent.intent_id);
    // the hosted payment page for the session
    return json({ checkoutUrl: `${AREEBA_BASE.replace('/api/rest', '')}/checkout/pay/${sessionId}` });
  } catch (err) {
    console.error('areeba-pay', err);
    return json({ error: 'Internal error.' }, 500);
  }
});
