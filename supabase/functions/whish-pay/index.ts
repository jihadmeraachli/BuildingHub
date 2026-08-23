// ============================================================
// whish-pay — start (or resume) a Whish payment for a subscription.
//
// PAY-FIRST (0117): there is no invoice yet. The client sends what it wants
// to buy — { subscription_id, kind: 'period'|'topup', plan?, add? } — and the
// AMOUNT IS COMPUTED SERVER-SIDE by create_payment_intent(). The Whish
// session hangs off the intent id; the invoice is created, already paid, by
// settle_payment_intent() in whish-callback once Whish confirms the money.
//
// SCOPE: subscription fees ONLY. Resident dues are not collected through
// this; a building advertises its own whish_number and residents pay it
// directly. This is our own corporate wallet taking our own fees.
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO:
//   · settle anything — only whish-callback does, after verifying with Whish
//   · trust the caller's amount — there IS no amount in the request at all.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const WHISH_BASE = Deno.env.get('WHISH_BASE_URL')
  ?? 'https://partner.api.sbx.whish.money/itel-service/api';   // sandbox until go-live
const WHISH_CHANNEL = Deno.env.get('WHISH_CHANNEL') ?? '';
const WHISH_SECRET = Deno.env.get('WHISH_SECRET') ?? '';
const WHISH_WEBSITE = Deno.env.get('WHISH_WEBSITE_URL') ?? '';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://app.abniyah.com';
const FN_URL = Deno.env.get('SUPABASE_URL') ?? '';

/** Their headers are the whole auth scheme — no signature, no token exchange.
 *  User-Agent is required to identify US, not Whish (their docs are explicit). */
const whishHeaders = () => ({
  channel: WHISH_CHANNEL,
  secret: WHISH_SECRET,
  websiteUrl: WHISH_WEBSITE,
  'User-Agent': `Abniyah/1.0 (${APP_URL}; support@abniyah.com)`,
  'Content-Type': 'application/json',
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    if (!WHISH_CHANNEL || !WHISH_SECRET || !WHISH_WEBSITE) {
      return json({ error: 'Whish is not configured yet.' }, 503);
    }

    const admin = createClient(FN_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── who is asking ────────────────────────────────────────────────────
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!jwt) return json({ error: 'Not signed in.' }, 401);
    const { data: userRes } = await admin.auth.getUser(jwt);
    if (!userRes?.user) return json({ error: 'Not signed in.' }, 401);

    const { subscription_id, kind, plan, add } = await req.json().catch(() => ({}));
    if (!subscription_id || !['period', 'topup'].includes(kind)) {
      return json({ error: 'subscription_id and kind are required.' }, 400);
    }

    // ── may this caller pay for this subscription? ───────────────────────
    // Asked as the CALLER (their own JWT) so the SQL gate answers it; the
    // service key would bypass exactly the check we want.
    const asCaller = createClient(FN_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: allowed } = await asCaller.rpc('user_manages_subscription', { p_subscription: subscription_id });
    if (!allowed) return json({ error: 'Not allowed.' }, 403);

    // ── the intent: amount and dates computed in SQL, never trusted ──────
    const { data: intents, error: intErr } = await admin.rpc('create_payment_intent', {
      p_subscription: subscription_id, p_kind: kind,
      p_plan: plan ?? null, p_add: add || null,
    });
    if (intErr) return json({ error: intErr.message }, 400);
    const intent = Array.isArray(intents) ? intents[0] : intents;
    if (!intent?.intent_id) return json({ error: 'Could not prepare the payment.' }, 500);

    // ── resume rather than re-create ─────────────────────────────────────
    // A failed attempt leaves the link payable, so the customer should land
    // back on the SAME one. A second link would be a second way to pay once.
    if (intent.collect_url) {
      return json({ collectUrl: intent.collect_url, resumed: true });
    }

    // USD with 2 decimals, sent as a STRING — their API rejects a JSON number.
    const amount = (intent.amount_cents / 100).toFixed(2);

    // Our own reference rides on the callback URL: Whish adds no identifying
    // parameters of its own and forwards ours unchanged.
    const cb = `${FN_URL}/functions/v1/whish-callback?intent=${intent.intent_id}`;

    const res = await fetch(`${WHISH_BASE}/payment/whish`, {
      method: 'POST',
      headers: whishHeaders(),
      body: JSON.stringify({
        amount,
        currency: 'USD',
        invoice: `Abniyah subscription ${intent.period_start} to ${intent.period_end}`,
        externalId: intent.intent_id,     // the intent id IS the reference
        successCallbackUrl: `${cb}&outcome=success`,
        failureCallbackUrl: `${cb}&outcome=failure`,
        successRedirectUrl: `${APP_URL}/licenses?paid=1`,
        failureRedirectUrl: `${APP_URL}/licenses?paid=0`,
      }),
    });

    // Their envelope always returns HTTP 200 — branch on the body, never the
    // status code (their docs say so, and it is easy to get wrong).
    const body = await res.json().catch(() => null);
    if (!body?.status || !body?.data?.collectUrl) {
      console.error('whish create failed', res.status, JSON.stringify(body));
      return json({ error: body?.dialog?.message ?? 'Could not start the payment.', code: body?.code }, 502);
    }

    const collectUrl = body.data.collectUrl as string;
    await admin.rpc('set_intent_collect', {
      p_intent: intent.intent_id, p_url: collectUrl, p_status: 'pending',
    });

    return json({ collectUrl, resumed: false });
  } catch (e) {
    console.error('whish-pay error', e);
    return json({ error: 'Could not start the payment.' }, 500);
  }
});
