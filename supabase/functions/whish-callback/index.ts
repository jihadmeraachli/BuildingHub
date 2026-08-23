// ============================================================
// whish-callback — confirm a Whish payment and settle the PAYMENT INTENT.
//
// PAY-FIRST (0117): settling an intent is what CREATES the invoice — already
// paid, the receipt — and applies the effect (period activated, or held
// licences landed) in one transaction, via settle_payment_intent().
//
// THE CALLBACK IS NOT PROOF. Whish calls this as an UNAUTHENTICATED GET with
// no body and no signature; their own documentation says to treat it as "a
// signal to verify, not as proof". Anyone who guesses the URL can call it. So
// this function NEVER settles on being called — it asks Whish for the payment
// status and settles only on collectStatus === 'success'.
//
// A FAILURE CALLBACK IS NOT A FAILED ORDER. The link stays payable after a
// failed attempt, and the customer can simply retry on it; status stays
// 'pending'. This does nothing on failure except record where things got to.
//
// ALSO THE RECONCILER. A callback can be lost to a transient network failure,
// and their docs say to reconcile by polling rather than treat it as a
// failure. GET ?reconcile=1 (cron, with CRON_SECRET) sweeps pending intents
// that have a payment link and asks about each. Same verification path — one
// place where a payment can settle, not two that can disagree.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const WHISH_BASE = Deno.env.get('WHISH_BASE_URL')
  ?? 'https://partner.api.sbx.whish.money/itel-service/api';
const WHISH_CHANNEL = Deno.env.get('WHISH_CHANNEL') ?? '';
const WHISH_SECRET = Deno.env.get('WHISH_SECRET') ?? '';
const WHISH_WEBSITE = Deno.env.get('WHISH_WEBSITE_URL') ?? '';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://app.abniyah.com';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

const whishHeaders = () => ({
  channel: WHISH_CHANNEL,
  secret: WHISH_SECRET,
  websiteUrl: WHISH_WEBSITE,
  'User-Agent': `Abniyah/1.0 (${APP_URL}; support@abniyah.com)`,
  'Content-Type': 'application/json',
});

const admin = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** Ask Whish what actually happened. Returns their collectStatus, or null when
 *  the answer was 'pending' in their envelope sense (status:false + code:500),
 *  which means UNKNOWN, not failed — retry later rather than conclude. */
async function collectStatus(externalId: string): Promise<string | null> {
  const res = await fetch(`${WHISH_BASE}/payment/collect/status`, {
    method: 'POST',
    headers: whishHeaders(),
    body: JSON.stringify({ currency: 'USD', externalId }),
  });
  const body = await res.json().catch(() => null);
  if (!body?.status) {
    // code 500 in their envelope means "no outcome yet", explicitly not failure
    console.warn('whish status inconclusive', externalId, JSON.stringify(body));
    return null;
  }
  return (body?.data?.collectStatus as string) ?? null;
}

/** Verify one intent against Whish and settle it if, and only if, Whish says
 *  the money arrived. Safe to call repeatedly: settle_payment_intent (0117)
 *  is idempotent — an already-paid intent returns its existing receipt. */
async function reconcileOne(intentId: string): Promise<string> {
  const db = admin();
  const status = await collectStatus(intentId);
  if (!status) return 'unknown';

  await db.rpc('set_intent_collect', { p_intent: intentId, p_url: null, p_status: status });

  if (status === 'success') {
    const { error } = await db.rpc('settle_payment_intent', {
      p_intent: intentId,
      p_method: 'whish',
      p_ref: intentId,      // externalId IS the intent id; unique by construction
    });
    if (error) {
      console.error('settle_payment_intent failed', intentId, error.message);
      return 'error';
    }
    return 'settled';
  }
  // pending / failed / refunded — recorded above, nothing to release
  return status;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  try {
    // ── cron sweep ───────────────────────────────────────────────────────
    if (url.searchParams.get('reconcile') === '1') {
      if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      const db = admin();
      const { data: pending } = await db
        .from('payment_intents')
        .select('id')
        .eq('status', 'pending')
        .not('collect_url', 'is', null)
        .limit(200);
      const results: Record<string, string> = {};
      for (const row of pending ?? []) results[row.id] = await reconcileOne(row.id);
      return new Response(JSON.stringify({ checked: Object.keys(results).length, results }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── the callback itself ──────────────────────────────────────────────
    const intentId = url.searchParams.get('intent');
    if (!intentId) return new Response('missing intent', { status: 400 });

    const outcome = await reconcileOne(intentId);
    console.log('whish callback', intentId, url.searchParams.get('outcome'), '→', outcome);

    // ALWAYS 200. Whish retries on a non-200, and every outcome here — settled,
    // already settled, still pending — means "received and handled". A retry
    // loop would be our bug, not theirs.
    return new Response('ok', { status: 200 });
  } catch (e) {
    console.error('whish-callback error', e);
    // Still 200: an exception here is ours to fix from the logs, and the cron
    // sweep will pick the payment up regardless.
    return new Response('ok', { status: 200 });
  }
});
