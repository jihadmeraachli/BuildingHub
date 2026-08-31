// vote-click — one-click voting from the notification email (0168).
//
// The email contains one link per option:
//   GET  ?u=<user>&p=<poll>&o=<option>&s=<hmac>
// The GET renders a tiny CONFIRM page (never casts - mail scanners follow
// every GET in an inbox, and a scanner must not vote). The Confirm button
// POSTs the same signed params; only then does the vote go in, through
// cast_vote_as() -> cast_vote(), so every rule (eligibility, revote
// replaces, windows, weights) is the SQL's, not ours.
//
// The HMAC key is the service-role key: both this function and
// dynamic-action (the signer) already hold it - no new secret to manage.
// Deploy note: JWT verification must be DISABLED for this function
// (Functions -> vote-click -> settings), it is opened by a mail client.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_URL = Deno.env.get('APP_URL') ?? 'https://app.abniyah.com';
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function hmac(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SERVICE_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(title: string, bodyHtml: string, lang = 'en') {
  const rtl = lang === 'ar';
  const html = `<!DOCTYPE html><html lang="${lang}"${rtl ? ' dir="rtl"' : ''}><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title></head>
  <body style="margin:0;background:#f5f6f8;font-family:'Segoe UI',Tahoma,Arial,sans-serif;${rtl ? 'direction:rtl;' : ''}">
  <div style="max-width:440px;margin:60px auto;padding:0 16px;">
    <div style="background:#0F4A3F;border-radius:16px 16px 0 0;padding:16px 28px;">
      <p style="margin:0;color:#fff;font-weight:700;letter-spacing:.12em;">ABNIYAH</p>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 16px 16px;padding:28px;">
      ${bodyHtml}
    </div>
  </div></body></html>`;
  // Encode to UTF-8 bytes and set the header on a Headers object: the plain
  // string + header literal came back as text/plain - browsers rendered the
  // source, offered a .txt download, and mangled Arabic/French.
  const headers = new Headers();
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(new TextEncoder().encode(html), { headers });
}

const T = {
  en: { confirmTitle: 'Confirm your vote', youAreVoting: 'You are voting on', yourChoice: 'Your choice', confirm: 'Confirm my vote',
        done: 'Vote recorded', doneBody: 'Your vote was recorded. You can change it any time before the vote closes, from the email or in the app.',
        closed: 'This vote is closed', closedBody: 'Voting had already ended, so nothing was recorded.',
        invalid: 'This link is not valid', invalidBody: 'The link is damaged or was not meant for you. Open the app to vote.',
        error: 'Could not record the vote', openApp: 'Open Abniyah' },
  ar: { confirmTitle: 'تأكيد صوتك', youAreVoting: 'أنت تصوّت على', yourChoice: 'خيارك', confirm: 'تأكيد صوتي',
        done: 'تم تسجيل صوتك', doneBody: 'سُجّل صوتك. يمكنك تغييره في أي وقت قبل إغلاق التصويت، من البريد أو من التطبيق.',
        closed: 'هذا التصويت مغلق', closedBody: 'انتهى التصويت، لم يُسجَّل شيء.',
        invalid: 'هذا الرابط غير صالح', invalidBody: 'الرابط تالف أو ليس موجهاً إليك. افتح التطبيق للتصويت.',
        error: 'تعذر تسجيل الصوت', openApp: 'فتح أبنية' },
  fr: { confirmTitle: 'Confirmez votre vote', youAreVoting: 'Vous votez sur', yourChoice: 'Votre choix', confirm: 'Confirmer mon vote',
        done: 'Vote enregistré', doneBody: 'Votre vote a été enregistré. Vous pouvez le modifier à tout moment avant la clôture, depuis le mail ou dans l\'application.',
        closed: 'Ce vote est clos', closedBody: 'Le vote était déjà terminé, rien n\'a été enregistré.',
        invalid: 'Ce lien n\'est pas valide', invalidBody: 'Le lien est endommagé ou ne vous était pas destiné. Ouvrez l\'application pour voter.',
        error: 'Impossible d\'enregistrer le vote', openApp: 'Ouvrir Abniyah' },
} as const;
type Lang = keyof typeof T;

const btn = (label: string) =>
  `<button type="submit" style="background:#0F4A3F;color:#fff;border:0;border-radius:10px;padding:12px 28px;font-size:15px;font-weight:600;cursor:pointer;">${label}</button>`;
const appLink = (label: string) =>
  `<p style="margin-top:20px;"><a href="${APP_URL}/voting" style="color:#0F4A3F;font-size:14px;">${label} &rarr;</a></p>`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const u = url.searchParams.get('u') ?? '';
  const p = url.searchParams.get('p') ?? '';
  const o = url.searchParams.get('o') ?? '';
  const s = url.searchParams.get('s') ?? '';

  // recipient language for every page on this journey
  let lang: Lang = 'en';
  if (u) {
    const { data: prof } = await db.from('profiles').select('preferred_language').eq('id', u).single();
    const pl = (prof?.preferred_language ?? 'en').slice(0, 2);
    lang = (pl === 'ar' || pl === 'fr') ? pl as Lang : 'en';
  }
  const L = T[lang];

  const expected = await hmac(`${u}:${p}:${o}`);
  if (!u || !p || !o || s !== expected) {
    return page(L.invalid, `<h2 style="margin:0 0 10px;color:#0f172a;">${L.invalid}</h2>
      <p style="color:#475569;font-size:14px;line-height:1.6;">${L.invalidBody}</p>${appLink(L.openApp)}`, lang);
  }

  const [{ data: poll }, { data: opt }] = await Promise.all([
    db.from('polls').select('id, title, status, closes_at').eq('id', p).single(),
    db.from('poll_options').select('id, label').eq('id', o).eq('poll_id', p).single(),
  ]);
  if (!poll || !opt) {
    return page(L.invalid, `<h2 style="margin:0 0 10px;color:#0f172a;">${L.invalid}</h2>
      <p style="color:#475569;font-size:14px;line-height:1.6;">${L.invalidBody}</p>${appLink(L.openApp)}`, lang);
  }
  if (poll.status !== 'open' || new Date(poll.closes_at) <= new Date()) {
    return page(L.closed, `<h2 style="margin:0 0 10px;color:#0f172a;">${L.closed}</h2>
      <p style="color:#475569;font-size:14px;line-height:1.6;">${L.closedBody}</p>${appLink(L.openApp)}`, lang);
  }

  if (req.method !== 'POST') {
    // scanner-safe confirm page: the GET never casts
    const qs = `u=${encodeURIComponent(u)}&p=${encodeURIComponent(p)}&o=${encodeURIComponent(o)}&s=${encodeURIComponent(s)}`;
    return page(L.confirmTitle, `<h2 style="margin:0 0 6px;color:#0f172a;">${L.confirmTitle}</h2>
      <p style="color:#475569;font-size:14px;margin:0 0 16px;">${L.youAreVoting}: <strong>${esc(poll.title)}</strong></p>
      <p style="color:#0f172a;font-size:15px;background:#f1f5f9;border-radius:10px;padding:10px 14px;margin:0 0 20px;">
        ${L.yourChoice}: <strong>${esc(opt.label)}</strong></p>
      <form method="POST" action="?${qs}">${btn(L.confirm)}</form>${appLink(L.openApp)}`, lang);
  }

  const { error } = await db.rpc('cast_vote_as', { p_user: u, p_poll: p, p_option_ids: [o] });
  if (error) {
    return page(L.error, `<h2 style="margin:0 0 10px;color:#0f172a;">${L.error}</h2>
      <p style="color:#b91c1c;font-size:14px;line-height:1.6;">${esc(error.message)}</p>${appLink(L.openApp)}`, lang);
  }
  return page(L.done, `<h2 style="margin:0 0 10px;color:#0f172a;">✓ ${L.done}</h2>
    <p style="color:#475569;font-size:14px;line-height:1.6;">${L.doneBody}</p>${appLink(L.openApp)}`, lang);
});
