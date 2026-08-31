// vote-click — the API behind one-click voting from the notification email
// (0168). JSON only, on purpose:
//
//   Supabase forcibly rewrites edge-function responses on *.supabase.co to
//   Content-Type: text/plain + a sandbox CSP (anti-phishing), so a function
//   there can NEVER render a page. The confirm UI therefore lives on our own
//   domain (app.abniyah.com/vote, a public route) and talks to this API.
//
//   GET  ?u&p&o&s -> { ok, title, option, closes_at }   NEVER casts: mail
//                    scanners follow every link in an inbox, and a scanner
//                    must not be able to vote.
//   POST ?u&p&o&s -> { ok } and the ballot is in.
//
// The vote itself goes through cast_vote_as() -> cast_vote(), so every rule
// (eligibility, owner-outranks-tenant, revote replaces, window, weights) is
// the SQL's, not ours. The link is HMAC-signed with the service-role key,
// which dynamic-action (the signer) and this function both already hold -
// no new secret to manage.
//
// Deploy note: JWT verification must be DISABLED for this function
// (Functions -> vote-click -> settings), it is called from a public page.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_URL = Deno.env.get('APP_URL') ?? 'https://app.abniyah.com';
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function hmac(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SERVICE_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  // A human landing here (an email sent before the links moved to the app,
  // or a pasted link) gets bounced to the confirm page; the page itself asks
  // for data with f=json. Redirects are not touched by the text/plain rewrite.
  if (req.method === 'GET' && url.searchParams.get('f') !== 'json') {
    return new Response(null, { status: 302, headers: { ...CORS, Location: `${APP_URL}/vote?${url.searchParams.toString()}` } });
  }
  const u = url.searchParams.get('u') ?? '';
  const p = url.searchParams.get('p') ?? '';
  const o = url.searchParams.get('o') ?? '';
  const s = url.searchParams.get('s') ?? '';

  const expected = await hmac(`${u}:${p}:${o}`);
  if (!u || !p || !o || s !== expected) return json({ ok: false, reason: 'invalid' }, 200);

  const [{ data: poll }, { data: opt }] = await Promise.all([
    db.from('polls').select('id, title, status, closes_at').eq('id', p).single(),
    db.from('poll_options').select('id, label').eq('id', o).eq('poll_id', p).single(),
  ]);
  if (!poll || !opt) return json({ ok: false, reason: 'invalid' }, 200);

  const closed = poll.status !== 'open' || new Date(poll.closes_at) <= new Date();
  if (closed) return json({ ok: false, reason: 'closed', title: poll.title, option: opt.label }, 200);

  // GET is informational only - the confirm page renders from this.
  if (req.method !== 'POST') {
    return json({ ok: true, title: poll.title, option: opt.label, closes_at: poll.closes_at });
  }

  const { error } = await db.rpc('cast_vote_as', { p_user: u, p_poll: p, p_option_ids: [o] });
  if (error) return json({ ok: false, reason: 'error', error: error.message }, 200);
  return json({ ok: true, cast: true, title: poll.title, option: opt.label });
});
