// ============================================================
// whish-pay — start (or resume) a Whish payment for a licence invoice.
//
// SCOPE: licence invoices ONLY. Resident dues are not collected through this;
// a building advertises its own whish_number and residents pay it directly.
// This is our own corporate wallet taking our own subscription fees.
//
// Flow (Whish Pay v1.4.4):
//   client → this function → POST /payment/whish → { collectUrl }
//   client redirects the payer → hosted Whish page → OTP in the Whish app
//   Whish GETs our callback → whish-callback verifies and settles
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO:
//   · settle anything — only whish-callback does, after verifying with Whish
//   · trust the caller's amount — it is read from the invoice, server side.
//     An amount coming from the browser is an invitation to pay $1 for a
//     $200 licence.
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
    const caller = userRes?.user;
    if (!caller) return json({ error: 'Not signed in.' }, 401);

    const { invoice_id } = await req.json();
    if (!invoice_id) return json({ error: 'invoice_id is required.' }, 400);

    // ── may this caller pay this invoice? ────────────────────────────────
    // Asked as the CALLER (their own JWT), so the invoices RLS policy from
    // 0031 answers it. Reading it on the service key would bypass exactly the
    // check we want, and hand anyone a link to anyone's invoice.
    const asCaller = createClient(FN_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: inv, error: invErr } = await asCaller
      .from('invoices')
      .select('id, status, amount_cents, collect_url, period_start, period_end')
      .eq('id', invoice_id)
      .maybeSingle();
    if (invErr) return json({ error: invErr.message }, 400);
    if (!inv) return json({ error: 'Invoice not found.' }, 404);
    if (inv.status === 'paid') return json({ error: 'That invoice is already paid.' }, 409);
    if (inv.status === 'void') return json({ error: 'That invoice was voided.' }, 409);

    // ── resume rather than re-create ─────────────────────────────────────
    // A failed attempt leaves the link payable, so the customer should land
    // back on the SAME one. A second link would be a second way to pay one
    // invoice.
    if (inv.collect_url) {
      return json({ collectUrl: inv.collect_url, resumed: true });
    }

    // Amount from the invoice, never from the request. USD with 2 decimals,
    // sent as a STRING — their API rejects a JSON number.
    const amount = (inv.amount_cents / 100).toFixed(2);

    // Our own reference rides on the callback URL: Whish adds no identifying
    // parameters of its own and forwards ours unchanged.
    const cb = `${FN_URL}/functions/v1/whish-callback?invoice=${inv.id}`;

    const res = await fetch(`${WHISH_BASE}/payment/whish`, {
      method: 'POST',
      headers: whishHeaders(),
      body: JSON.stringify({
        amount,
        currency: 'USD',
        invoice: `Abniyah licence ${inv.period_start} to ${inv.period_end}`,
        externalId: inv.id,               // the invoice id IS the reference
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
    await admin.rpc('set_invoice_collect', {
      p_invoice: inv.id, p_url: collectUrl, p_status: 'pending',
    });

    return json({ collectUrl, resumed: false });
  } catch (e) {
    console.error('whish-pay error', e);
    return json({ error: 'Could not start the payment.' }, 500);
  }
});
