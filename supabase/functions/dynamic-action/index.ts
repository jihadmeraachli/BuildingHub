import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL = Deno.env.get('FROM_EMAIL')!;
const APP_URL = Deno.env.get('APP_URL')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// service-role client → bypasses RLS, can read grants/memberships/profiles freely
const serviceKeyForHmac = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_FN_URL = (Deno.env.get('SUPABASE_URL') ?? '') + '/functions/v1';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Optional shared secret: when the WEBHOOK_SECRET env var is set, requests must
// carry the same value in the x-webhook-secret header (configure it on every
// Database Webhook). Unset = legacy open behavior, so enabling is a two-step
// opt-in that can't break email delivery by accident.
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') ?? '';

// Record fields are attacker-influenced text - escape before interpolating into HTML.
const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Only http(s) links may appear as hrefs in emails.
const safeUrl = (v: unknown): string | null => {
  const s = String(v ?? '');
  return /^https?:\/\//i.test(s) ? s : null;
};

// ── Email primitives ─────────────────────────────────────────────────────────
interface Attachment { filename: string; content: string; }

/** Returns null on success, or Resend's error text. The caller logs it - this
 *  used to return nothing, so every send was logged as "sent" even when Resend
 *  rejected it, and a bounced building looked identical to a delivered one. */
async function sendEmail(to: string, subject: string, html: string, fromName?: string, attachments?: Attachment[]): Promise<string | null> {
  const from = fromName ? `"${fromName}" <${FROM_EMAIL}>` : FROM_EMAIL;
  const body: Record<string, unknown> = { from, to, subject, html };
  if (attachments?.length) body.attachments = attachments;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const why = await res.text().catch(() => '');
  console.error('Resend error:', why);
  return why || `HTTP ${res.status}`;
}

// `Dict` is declared further down with the language packs; a type reference
// hoists, and DICT/langOf are only read at request time, long after module init.
function emailHtml(L: Dict, title: string, bodyHtml: string, ctaLabel: string, ctaUrl: string) {
  // Arabic needs the direction on the document AND on the body: Gmail strips
  // <html> attributes, Outlook honours them, and between them only the inline
  // style survives everywhere. Tahoma is the one Arabic face Outlook ships.
  const rtl = L.dir === 'rtl';
  const dirAttr = rtl ? ' dir="rtl"' : '';
  const bodyDir = rtl ? 'direction:rtl;text-align:right;' : '';
  const font = rtl ? "'Segoe UI',Tahoma,Arial,sans-serif" : "'Segoe UI',Arial,sans-serif";
  return `<!DOCTYPE html><html${dirAttr}><head><meta charset="utf-8"></head>
  <body style="margin:0;padding:0;background:#f5f6f8;font-family:${font};${bodyDir}">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
        <tr><td style="background:#0F4A3F;padding:18px 32px;">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="vertical-align:middle;padding-right:10px;"><img src="https://abniyah.com/email-logo.png" width="26" height="26" alt="" style="display:block;border:0;" /></td>
            <td style="vertical-align:middle;"><p style="margin:0;color:#fff;font-size:18px;font-weight:700;letter-spacing:0.12em;">ABNIYAH</p></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 16px;font-size:18px;color:#0f172a;font-weight:600;">${title}</h2>
          ${bodyHtml}
          <div style="margin-top:28px;">
            <a href="${ctaUrl}" style="display:inline-block;background:#0F4A3F;color:#fff;text-decoration:none;padding:10px 24px;border-radius:10px;font-size:14px;font-weight:600;">${ctaLabel}</a>
          </div>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #f1f5f9;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">${L.footer}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
}

const row = (label: string, value: string) =>
  `<tr><td style="padding:6px 0;color:#94a3b8;font-size:14px;width:120px;vertical-align:top;">${label}</td>
   <td style="padding:6px 0;color:#0f172a;font-size:14px;">${value}</td></tr>`;
const table = (rows: string) => `<table style="width:100%;border-collapse:collapse;">${rows}</table>`;
const money = (n: number) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Dual-currency log (0086): "$100.00 + LL 5,000,000 @ 89,500" when the entry
// carried an LBP part. amount_usd stays the canonical total everywhere.
function lbpNote(rec: { amount_usd?: number; amount_lbp?: number | null; lbp_rate?: number | null }): string | null {
  if (!rec?.amount_lbp || !rec?.lbp_rate) return null;
  const usdPart = Math.round((Number(rec.amount_usd) - Number(rec.amount_lbp) / Number(rec.lbp_rate)) * 100) / 100;
  const ll = `LL ${Number(rec.amount_lbp).toLocaleString('en-US', { maximumFractionDigits: 0 })} @ ${Number(rec.lbp_rate).toLocaleString('en-US')}`;
  return usdPart > 0.004 ? `${money(usdPart)} + ${ll}` : ll;
}

// ── WhatsApp primitives (Meta Cloud API) ─────────────────────────────────────
// Disabled until both secrets are set - same two-step opt-in as WEBHOOK_SECRET,
// so deploying this code changes nothing until the Meta account is ready.
// Template names below must match the pre-approved templates in Meta Business
// Manager EXACTLY (name + variable count/order) - see docs/WHATSAPP_SETUP.md.
const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_TOKEN') ?? '';
const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID') ?? '';
const WHATSAPP_LANG = Deno.env.get('WHATSAPP_LANG') || 'en';
// Per-language templates (0060): OFF = legacy bilingual bodies (params doubled,
// single language code). Flip to '1' ONLY after the per-language template
// variants are approved in Meta - see docs/WHATSAPP_SETUP.md Part 2b.
const WHATSAPP_PER_LANG = Deno.env.get('WHATSAPP_PER_LANG') === '1';
const whatsappEnabled = () => Boolean(WHATSAPP_TOKEN && WHATSAPP_PHONE_ID);

type WaLang = 'en' | 'ar';

/** The final "how to pay" line of money templates ({{5}}/{{6}} in the
 *  per-language bodies): the building's Whish account when set, else generic. */
function payLine(lang: WaLang, whish?: string | null): string {
  if (whish) {
    return lang === 'ar'
      ? `يمكنك الدفع مباشرة عبر Whish إلى ${whish}.`
      : `You can pay directly through Whish to ${whish}.`;
  }
  return lang === 'ar'
    ? 'تجد التفاصيل وخيارات الدفع في حسابك.'
    : 'Details and payment options are in your account.';
}

/** Lebanon-first phone normalization → international digits (no '+').
 *  "+961 3 123 456" → 9613123456 · "03 123 456" → 9613123456 · "70123456" → 96170123456 */
function waPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('961')) return d.length >= 10 ? d : null;
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 7 || d.length === 8) return '961' + d; // local mobile without country code
  return d.length >= 10 ? d : null; // already international (non-Lebanese)
}

/** Template params may not be empty or contain newlines/tabs (Meta rejects the send). */
const waParam = (v: unknown) => (String(v ?? '').replace(/\s+/g, ' ').trim() || '-');

async function sendWhatsApp(toPhone: string, templateName: string, params: string[], lang: WaLang = 'en') {
  // Legacy mode: templates are BILINGUAL - an Arabic section ({{1}}..{{n}})
  // then an English section ({{n+1}}..{{2n}}); the same values are sent twice.
  // Per-language mode (WHATSAPP_PER_LANG): one language variant per recipient,
  // params sent once, language code per profile. Bodies: docs/WHATSAPP_SETUP.md.
  const finalParams = WHATSAPP_PER_LANG ? params : [...params, ...params];
  const langCode = WHATSAPP_PER_LANG ? lang : WHATSAPP_LANG;
  const res = await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toPhone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: langCode },
        components: finalParams.length
          ? [{ type: 'body', parameters: finalParams.map((p) => ({ type: 'text', text: waParam(p) })) }]
          : [],
      },
    }),
  });
  if (!res.ok) console.error(`WhatsApp error (${templateName}):`, await res.text());
}

/** Send one template to a set of users, honoring notify_whatsapp + saved phone.
 *  buildParams receives the recipient's name and language, so templates can
 *  greet personally and money templates can localize the pay line (0060). */
async function whatsappToUserIds(ids: string[], templateName: string, buildParams: (name: string, lang: WaLang) => string[]) {
  if (!whatsappEnabled()) return;
  const uniq = [...new Set(ids)];
  if (!uniq.length) return;
  const { data: profs } = await supabase.from('profiles')
    .select('id, full_name, phone, notify_whatsapp, preferred_language').in('id', uniq);
  for (const p of (profs ?? []) as { id: string; full_name: string; phone: string | null; notify_whatsapp: boolean; preferred_language: string | null }[]) {
    if (!p.notify_whatsapp) continue;
    const phone = waPhone(p.phone);
    const lang: WaLang = p.preferred_language === 'ar' ? 'ar' : 'en';
    if (phone) await sendWhatsApp(phone, templateName, buildParams(p.full_name || 'there', lang), lang);
  }
}


// ── Billing recipients (0114): the scope's managing admins ───────────────────
async function subscriptionAdminIds(sub: { scope_type: string; building_id?: string | null; compound_id?: string | null; org_id?: string | null }): Promise<string[]> {
  let q = supabase.from('grants').select('user_id, expires_at');
  if (sub.scope_type === 'building') q = q.eq('building_id', sub.building_id).eq('role', 'building_admin');
  else if (sub.scope_type === 'compound') q = q.eq('compound_id', sub.compound_id).eq('role', 'compound_admin');
  else q = q.eq('org_id', sub.org_id).eq('role', 'org_admin');
  const { data } = await q;
  const today = new Date().toISOString().slice(0, 10);
  return [...new Set(((data ?? []) as { user_id: string; expires_at: string | null }[])
    .filter((g) => !g.expires_at || g.expires_at >= today).map((g) => g.user_id))];
}
async function subscriptionScopeName(sub: { scope_type: string; building_id?: string | null; compound_id?: string | null; org_id?: string | null }): Promise<string> {
  const t = sub.scope_type === 'building' ? ['buildings', sub.building_id] : sub.scope_type === 'compound' ? ['compounds', sub.compound_id] : ['organizations', sub.org_id];
  const { data } = await supabase.from(t[0] as string).select('name').eq('id', t[1]).single();
  return (data as { name: string } | null)?.name ?? '';
}
const centsFmt = (c: number) => `${(c / 100).toFixed(2)}`;

// ── Recipient resolution (v3 model: memberships, with legacy fallback) ────────
async function getBuilding(buildingId: string) {
  const { data } = await supabase.from('buildings').select('name, address, city, country, whish_number').eq('id', buildingId).single();
  return data ?? null;
}
async function getUserEmail(userId: string): Promise<string | null> {
  const { data: { user } } = await supabase.auth.admin.getUserById(userId);
  return user?.email ?? null;
}

/** owner/occupant user ids of a unit (new model). ended_at IS NULL is load-bearing:
 *  removing an owner CLOSES the membership (kept for financial history) - closed
 *  rows must never receive notifications. */
async function unitOwnerIds(unitId: string): Promise<string[]> {
  const { data } = await supabase.from('memberships').select('user_id').eq('unit_id', unitId).is('ended_at', null);
  return (data ?? []).map((m: { user_id: string }) => m.user_id);
}

/** Active membership user ids of a unit for a given party (finance #9):
 *   'owner'  → tenure = owner
 *   'tenant' → tenure = tenant; if tenantId is given & still active, just that one
 *   'both'   → everyone (owner + tenant)
 *  Charges/payments carry paid_by / billed_to (+ tenant_id, 0066) so a charge
 *  billed to the tenant never reaches the owner, and vice-versa. */
async function unitPartyIds(unitId: string, party: 'owner' | 'tenant' | 'both', tenantId?: string | null): Promise<string[]> {
  if (party === 'both') return unitOwnerIds(unitId);
  const { data } = await supabase.from('memberships').select('user_id, tenure').eq('unit_id', unitId).is('ended_at', null);
  const rows = ((data ?? []) as { user_id: string; tenure: string }[]).filter((m) => m.tenure === party);
  const ids = rows.map((m) => m.user_id);
  // Dues audit D4: when a dues row names a specific tenant, resolve to THAT
  // tenant if still active, else NOBODY - never fall back to the unit's current
  // tenant, which leaks a departed tenant's dues notification (and its amount)
  // to their replacement.
  if (party === 'tenant' && tenantId) return ids.includes(tenantId) ? [tenantId] : [];
  return ids;
}

/** everyone living in a building: memberships ∪ legacy profiles.building_id */
async function voteLinkSig(uid: string, poll: string, option: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(serviceKeyForHmac),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${uid}:${poll}:${option}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function buildingResidentIds(buildingId: string): Promise<string[]> {
  const ids = new Set<string>();
  const { data: us } = await supabase.from('units').select('id').eq('building_id', buildingId);
  const unitIds = (us ?? []).map((u: { id: string }) => u.id);
  if (unitIds.length) {
    const { data: ms } = await supabase.from('memberships').select('user_id').in('unit_id', unitIds).is('ended_at', null);
    (ms ?? []).forEach((m: { user_id: string }) => ids.add(m.user_id));
  }
  const { data: legacy } = await supabase.from('profiles').select('id').eq('building_id', buildingId).eq('status', 'active');
  (legacy ?? []).forEach((p: { id: string }) => ids.add(p.id));
  return [...ids];
}

/** admins of a building: grants (building + org) ∪ platform admins ∪ legacy roles */
async function buildingAdminIds(buildingId: string): Promise<string[]> {
  const ids = new Set<string>();
  const { data: bg } = await supabase.from('grants').select('user_id').eq('scope_type', 'building').eq('building_id', buildingId);
  (bg ?? []).forEach((g: { user_id: string }) => ids.add(g.user_id));
  const { data: ob } = await supabase.from('org_buildings').select('org_id').eq('building_id', buildingId);
  const orgIds = (ob ?? []).map((o: { org_id: string }) => o.org_id);
  if (orgIds.length) {
    const { data: og } = await supabase.from('grants').select('user_id').eq('scope_type', 'org').in('org_id', orgIds);
    (og ?? []).forEach((g: { user_id: string }) => ids.add(g.user_id));
  }
  const { data: pa } = await supabase.from('profiles').select('id').eq('is_platform_admin', true);
  (pa ?? []).forEach((p: { id: string }) => ids.add(p.id));
  const { data: sa } = await supabase.from('profiles').select('id').eq('role', 'super_admin');
  (sa ?? []).forEach((p: { id: string }) => ids.add(p.id));
  const { data: ba } = await supabase.from('profiles').select('id').eq('role', 'building_admin').eq('building_id', buildingId);
  (ba ?? []).forEach((p: { id: string }) => ids.add(p.id));
  return [...ids];
}

// ── Push notifications (Apple APNs) ──────────────────────────────────────────
// Real phone alerts: they arrive with the app closed and the phone locked,
// unlike the in-app bell. Secrets are set in Supabase → Edge Functions:
//   APNS_KEY_ID      the 10-char key id from developer.apple.com
//   APNS_TEAM_ID     the 10-char team id (NOT the same value)
//   APNS_PRIVATE_KEY the whole .p8 file contents, BEGIN/END lines included
// Missing any of them simply disables push; email and WhatsApp are unaffected.
const APNS_KEY_ID = Deno.env.get('APNS_KEY_ID') ?? '';
const APNS_TEAM_ID = Deno.env.get('APNS_TEAM_ID') ?? '';
const APNS_PRIVATE_KEY = Deno.env.get('APNS_PRIVATE_KEY') ?? '';
const APNS_BUNDLE_ID = 'com.abniyah.app';
const pushEnabled = () => Boolean(APNS_KEY_ID && APNS_TEAM_ID && APNS_PRIVATE_KEY);

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Apple rejects a token older than an hour, and refuses one regenerated more
// often than every 20 minutes - so it is cached, not rebuilt per notification.
let apnsJwtCache = { token: '', madeAt: 0 };
async function apnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (apnsJwtCache.token && now - apnsJwtCache.madeAt < 1800) return apnsJwtCache.token;

  const der = Uint8Array.from(
    atob(APNS_PRIVATE_KEY.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'ES256', kid: APNS_KEY_ID })));
  const body = b64url(new TextEncoder().encode(JSON.stringify({ iss: APNS_TEAM_ID, iat: now })));
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${body}`),
  );
  apnsJwtCache = { token: `${head}.${body}.${b64url(sig)}`, madeAt: now };
  return apnsJwtCache.token;
}

async function apnsPost(host: string, token: string, payload: unknown) {
  return await fetch(`https://${host}/3/device/${token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${await apnsJwt()}`,
      'apns-topic': APNS_BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    },
    body: JSON.stringify(payload),
  });
}

/** Push to a set of users, honouring notify_push. Never throws - a push
 *  failure must not stop the email that carries the same news. */
async function pushToUserIds(ids: string[], title: string, body?: string) {
  try {
    if (!pushEnabled()) return;
    const uniq = [...new Set(ids)];
    if (!uniq.length) return;

    const { data: profs } = await supabase.from('profiles').select('id, notify_push').in('id', uniq);
    const allowed = ((profs ?? []) as { id: string; notify_push: boolean }[])
      .filter((p) => p.notify_push !== false).map((p) => p.id);
    if (!allowed.length) return;

    const { data: devices } = await supabase
      .from('device_tokens').select('token').in('user_id', allowed);
    if (!devices?.length) return;

    const payload = { aps: { alert: body ? { title, body } : { title }, sound: 'default' } };

    for (const d of devices as { token: string }[]) {
      // TestFlight AND the App Store are both "production"; only builds run
      // straight from Xcode are sandbox. Try production, then fall back on the
      // one error that specifically means wrong environment.
      let res = await apnsPost('api.push.apple.com', d.token, payload);
      if (res.status === 400) {
        const why = await res.clone().json().catch(() => ({} as { reason?: string }));
        if (why.reason === 'BadDeviceToken') {
          res = await apnsPost('api.sandbox.push.apple.com', d.token, payload);
        }
      }
      if (res.status === 410) {
        // Apple: this device is gone for good. Stop sending to it.
        await supabase.from('device_tokens').delete().eq('token', d.token);
        console.log('[push] pruned dead token');
        continue;
      }
      console.log(res.ok
        ? `[push] sent - "${title}"`
        : `[push] FAILED ${res.status}: ${await res.text().catch(() => '')}`);
    }
  } catch (e) {
    console.error('[push] error', e);
  }
}

/** Email a set of users, each in their own language, honoring notify_email.
 *
 *  The caller hands over a BUILDER rather than a finished subject and body,
 *  because one event now produces up to three different emails. Recipients are
 *  grouped by preferred_language and the builder runs once per group - not once
 *  per person, which would re-render the same HTML for every neighbour in a
 *  200-unit compound. */
async function emailToUserIds(
  ids: string[],
  build: (L: Dict, uid?: string) => { subject: string; html: string } | Promise<{ subject: string; html: string }>,
  fromName?: string,
  attachments?: Attachment[],
) {
  const uniq = [...new Set(ids)];
  // Every outcome is logged. This used to discard sendEmail()'s error string,
  // so a Resend rejection, an opted-out recipient or an empty id list all
  // looked identical from the dashboard: a boot, a shutdown, and no email.
  if (!uniq.length) { console.log('[email] no recipients'); return; }
  const { data: profs } = await supabase.from('profiles')
    .select('id, notify_email, preferred_language').in('id', uniq);

  const groups = new Map<Lang, { id: string; notify_email: boolean }[]>();
  for (const p of (profs ?? []) as { id: string; notify_email: boolean; preferred_language: string | null }[]) {
    const lang = langOf(p.preferred_language);
    if (!groups.has(lang)) groups.set(lang, []);
    groups.get(lang)!.push({ id: p.id, notify_email: p.notify_email });
  }

  for (const [lang, members] of groups) {
    // Same event, one alert per channel: everything that emails also pushes.
    // The subject is a complete, specific line and iOS shows the app name
    // above it, so it doubles as the alert title, in the reader's language.
    // The builder runs per member since 0168: signed one-click vote links
    // are personal, so two neighbours' emails are no longer identical.
    const { subject: groupSubject } = await build(DICT[lang], members[0]?.id);
    void pushToUserIds(members.map((m) => m.id), groupSubject);
    for (const p of members) {
      if (!p.notify_email) { console.log(`[email] skip ${p.id} - notify_email off`); continue; }
      const email = await getUserEmail(p.id);
      if (!email) { console.log(`[email] skip ${p.id} - no auth email`); continue; }
      const { subject, html } = await build(DICT[lang], p.id);
      const err = await sendEmail(email, subject, html, fromName, attachments);
      console.log(err ? `[email] FAILED ${email}: ${err}` : `[email] sent ${email} [${lang}] - "${subject}"`);
    }
  }
}

// ── .ics generation (unchanged) ───────────────────────────────────────────────
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}
function generateIcs(uid: string, title: string, meeting_date: string, meeting_time: string | null, summary: string, building: { name: string; address: string; city: string; country: string }): string {
  const dateStr = meeting_date.replace(/-/g, '');
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const location = `${building.address}, ${building.city}, ${building.country}`;
  let dtstart: string, dtend: string;
  if (meeting_time) {
    const tm = meeting_time.replace(/:/g, '').slice(0, 6).padEnd(6, '0');
    const endHour = String((parseInt(tm.slice(0, 2)) + 1) % 24).padStart(2, '0');
    dtstart = `DTSTART:${dateStr}T${tm}`;
    dtend = `DTEND:${dateStr}T${endHour}${tm.slice(2)}`;
  } else {
    dtstart = `DTSTART;VALUE=DATE:${dateStr}`;
    dtend = `DTEND;VALUE=DATE:${dateStr}`;
  }
  const desc = summary ? `DESCRIPTION:${summary.replace(/[\r\n]+/g, '\\n')}` : null;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Abniyah//EN', 'CALSCALE:GREGORIAN', 'METHOD:REQUEST',
    'BEGIN:VEVENT', `UID:${uid}@buildinghub`, `DTSTAMP:${now}`, dtstart, dtend,
    `SUMMARY:${title}`, `LOCATION:${location}`, desc,
    `ORGANIZER;CN="${building.name}":mailto:${FROM_EMAIL}`, 'STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

// ── Language ─────────────────────────────────────────────────────────────────
// Every email used to go out in English, including to the Arabic-only residents
// this app was built for. Each person's profiles.preferred_language (0101 added
// 'fr') now chooses the wording, the reading direction and the label maps.
//
// ENGLISH IS THE SOURCE OF TRUTH: `Dict` is inferred from EN, so the compiler
// refuses an AR or FR pack that is missing a key. A translation can be wrong;
// it can no longer be silently absent.
//
// TERMINOLOGY is lifted from src/i18n/{ar,fr}.json rather than translated
// fresh, so an email says the same word the screen does - a French syndic
// reads "lot" and "appel de fonds" in both places.
//
// ESCAPING, and this matters: `subj` builders take RAW text, because a subject
// line is not HTML. Everything else is interpolated into HTML and takes values
// the caller has ALREADY put through esc().
type Lang = 'en' | 'ar' | 'fr';
const langOf = (v: unknown): Lang => (v === 'ar' || v === 'fr' ? v : 'en');

const EN = {
  dir: 'ltr' as 'ltr' | 'rtl',
  footer: 'You received this because you have notifications enabled in Abniyah.',
  ctaAccount: 'View My Account',
  ctaIssue: 'View Issue',
  priority: { low: 'Low', medium: 'Medium', urgent: '🔴 Urgent' } as Record<string, string>,
  category: {
    water: 'Water', electricity: 'Electricity', common_expenses: 'Common Expenses',
    projects: 'Projects', contracts: 'Contracts', fines: 'Fines', other: 'Other',
  } as Record<string, string>,
  method: { cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque', other: 'Other' } as Record<string, string>,
  tenure: { owner: 'Owner', tenant: 'Tenant' } as Record<string, string>,
  whish: (n: string) => `You can pay directly through <strong>Whish</strong> to <strong>${n}</strong>.`,

  billing: {
    trialSubj: (scope: string) => `Welcome to Abniyah - your 30-day trial for ${scope} has started`,
    trialTitle: 'Your trial has started',
    trialBody: (scope: string, d: string) =>
      `Everything is unlocked for <strong>${scope}</strong> until <strong>${d}</strong>: unlimited licences, every feature, no card. We will remind you before it ends; nothing is ever charged until you subscribe.`,
    invoiceSubj: (scope: string, amount: string) => `Invoice for ${scope}: ${amount}`,
    invoiceTitle: 'Invoice issued',
    invoiceBody: (scope: string, amount: string, due: string, period: string) =>
      `An invoice of <strong>${amount}</strong> for <strong>${scope}</strong> (${period}) is ready. Pay it from the Billing page by <strong>${due}</strong> - Whish or card.`,
    receiptSubj: (scope: string, amount: string) => `Payment received for ${scope}: ${amount}`,
    receiptTitle: 'Payment received',
    receiptBody: (scope: string, amount: string, period: string) =>
      `Thank you - <strong>${amount}</strong> received for <strong>${scope}</strong> (${period}). Your subscription is active; the receipt is on the Billing page.`,
    cta: 'Open Billing',
  },
  reg: {
    subj: 'New resident registration awaiting approval',
    title: 'New resident registration',
    intro: 'A new resident has registered and is awaiting your approval.',
    name: 'Name', apartment: 'Apartment', phone: 'Phone',
    cta: 'Review Registration',
  },
  issue: {
    subj: (t: string) => `New issue reported: ${t}`,
    title: 'New issue reported',
    intro: (b: string) => `A new issue has been logged in <strong>${b}</strong>.`,
    rTitle: 'Title', rPriority: 'Priority', rLocation: 'Location',
    rApartment: 'Apartment', rDescription: 'Description',
  },
  issueDone: {
    subj: (t: string) => `Issue resolved: ${t}`,
    title: 'Your issue has been resolved',
    rNotes: 'Notes',
  },
  charge: {
    subj: (d: string) => `New charge: ${d}`,
    fallback: 'Charge',
    title: 'New charge added',
    intro: "A new charge has been added to your unit's account.",
    rDescription: 'Description', rCategory: 'Category', rAmount: 'Amount',
  },
  paid: {
    subj: 'Payment received',
    title: 'Payment recorded',
    intro: "We've recorded your payment. Thank you.",
    rAmount: 'Amount', rPaidAs: 'Paid as', rMethod: 'Method', rDate: 'Date',
  },
  paidEdit: {
    subj: 'Your payment was updated',
    title: 'Payment updated',
    intro: 'A payment on your account was updated.',
    rNewAmount: 'New amount', rDate: 'Date',
  },
  paidGone: {
    subj: 'A payment was removed',
    title: 'Payment removed',
    intro: (amt: string) => `A payment of <strong>${amt}</strong> was removed from your account.`,
  },
  transfer: {
    rUnit: 'Unit', rAmount: 'Amount', rFormer: 'Former tenant',
    ownerSubj: 'Balance transferred from former tenant',
    ownerTitle: 'Balance transferred to the owner account',
    ownerIntro: 'A former tenant moved out and their remaining balance was transferred to the owner account.',
    tenantSubj: 'Your balance was transferred on move-out',
    tenantTitle: 'Balance transferred to the unit owner',
    tenantIntro: 'On move-out, your remaining balance on this unit was transferred to the owner account.',
  },
  dues: {
    subj: (p: string, a: string) => `Prepaid amount for ${p}: ${a}`,
    title: 'Prepaid amount issued',
    intro: (p: string) => `Your prepaid amount for <strong>${p}</strong> is ready.`,
    rFor: 'For', rAmountDue: 'Amount due', rDueDate: 'Due date',
    editSubj: (p: string) => `Prepaid amount updated: ${p}`,
    editTitle: 'Prepaid amount updated',
    editIntro: (p: string) => `Your prepaid amount for <strong>${p}</strong> was updated.`,
    rNewAmount: 'New amount',
    goneSubj: (p: string) => `Prepaid amount removed: ${p}`,
    goneTitle: 'Prepaid amount removed',
    goneIntro: (p: string) => `Your prepaid amount for <strong>${p}</strong> was removed.`,
  },
  request: {
    subj: (b: string, u: string) => `Payment requested: ${b}, unit ${u}`,
    title: 'Payment requested',
    fallback: 'Outstanding balance',
    intro: (what: string, unit: string, amount: string) =>
      `<strong>${what}</strong> - unit <strong>${unit}</strong> has <strong style="color:#dc2626;">${amount}</strong> to settle.`,
    rAmount: 'Amount', rDueBy: 'Due by',
  },
  invite: {
    subj: (u: string, b: string) => `Unit invitation: ${u} at ${b}`,
    title: 'You have been invited to a unit',
    intro: (who: string) => `${who} wants to link your account to a unit. Nothing happens until you accept.`,
    defaultInviter: 'A building admin',
    rUnit: 'Unit', rBuilding: 'Building', rAs: 'As',
    hint: 'Sign in and accept or decline the invitation on your dashboard.',
    cta: 'Review Invitation',
  },
  meeting: {
    subj: (t: string) => `📅 Meeting invite: ${t}`,
    title: (t: string) => `You're invited: ${t}`,
    intro: (b: string) => `A meeting has been scheduled at <strong>${b}</strong>.`,
    rDate: 'Date', rTime: 'Time', rOnline: 'Online', rNotes: 'Notes',
    joinLink: 'Join link',
    icsNote: '📎 A calendar invite (.ics) is attached.',
    cta: 'View in Abniyah',
  },
  lost: {
    subj: (t: string) => `Lost & found: ${t}`,
    title: (t: string) => `Found: ${t}`,
    intro: (b: string, w: string) => `A new item was posted to the lost & found at <strong>${b}</strong>` + (w ? ` (found: <strong>${w}</strong>)` : '') + `. Check if it's yours.`,
    cta: 'Open Lost & Found',
  },
  vote: {
    subjOpen: (t: string) => `Vote: ${t}`,
    titleOpen: (t: string) => `Voting is open: ${t}`,
    introOpen: (b: string, d: string) => `A vote is open at <strong>${b}</strong> until <strong>${d}</strong>. Have your say.`,
    oneClick: 'Vote with one click - you can change it any time before the close:',
    orApp: 'Or vote in the app:',
    cta: 'Cast your vote',
    subjClosed: (t: string) => `Vote closed: ${t}`,
    titleClosed: (t: string) => `The results are in: ${t}`,
    introClosed: (b: string) => `Voting has closed at <strong>${b}</strong>.`,
    ctaResults: 'See the results',
  },
};
type Dict = typeof EN;

const AR: Dict = {
  dir: 'rtl',
  footer: 'وصلتك هذه الرسالة لأن الإشعارات مفعّلة في حسابك على أبنية.',
  ctaAccount: 'عرض حسابي',
  ctaIssue: 'عرض المشكلة',
  priority: { low: 'منخفضة', medium: 'متوسطة', urgent: '🔴 عاجلة' },
  category: {
    water: 'المياه', electricity: 'الكهرباء', common_expenses: 'المصاريف المشتركة',
    projects: 'المشاريع', contracts: 'العقود', fines: 'الغرامات', other: 'أخرى',
  },
  method: { cash: 'نقداً', bank_transfer: 'تحويل بنكي', cheque: 'شيك', other: 'أخرى' },
  tenure: { owner: 'مالك', tenant: 'مستأجر' },
  whish: (n: string) => `يمكنك الدفع مباشرة عبر <strong>Whish</strong> إلى <strong>${n}</strong>.`,

  billing: {
    trialSubj: (scope: string) => `أهلاً بك في أبنية - بدأت تجربتك المجانية لـ${scope} لمدة 30 يوماً`,
    trialTitle: 'بدأت تجربتك',
    trialBody: (scope: string, d: string) =>
      `كل شيء مفتوح لـ<strong>${scope}</strong> حتى <strong>${d}</strong>: رخص غير محدودة، كل الميزات، بلا بطاقة. سنذكّرك قبل النهاية؛ لا يُقتطع شيء أبداً قبل أن تشترك.`,
    invoiceSubj: (scope: string, amount: string) => `فاتورة لـ${scope}: ${amount}`,
    invoiceTitle: 'صدرت فاتورة',
    invoiceBody: (scope: string, amount: string, due: string, period: string) =>
      `فاتورة بقيمة <strong>${amount}</strong> لـ<strong>${scope}</strong> (${period}) جاهزة. سدّدها من صفحة الفوترة قبل <strong>${due}</strong> - عبر Whish أو البطاقة.`,
    receiptSubj: (scope: string, amount: string) => `استلمنا دفعة لـ${scope}: ${amount}`,
    receiptTitle: 'استلمنا الدفعة',
    receiptBody: (scope: string, amount: string, period: string) =>
      `شكراً - استلمنا <strong>${amount}</strong> لـ<strong>${scope}</strong> (${period}). اشتراكك فعّال؛ الإيصال في صفحة الفوترة.`,
    cta: 'فتح الفوترة',
  },
  reg: {
    subj: 'تسجيل ساكن جديد بانتظار الموافقة',
    title: 'تسجيل ساكن جديد',
    intro: 'سجّل ساكن جديد وهو بانتظار موافقتك.',
    name: 'الاسم', apartment: 'الشقة', phone: 'الهاتف',
    cta: 'مراجعة التسجيل',
  },
  issue: {
    subj: (t: string) => `مشكلة جديدة: ${t}`,
    title: 'تم الإبلاغ عن مشكلة جديدة',
    intro: (b: string) => `تم تسجيل مشكلة جديدة في <strong>${b}</strong>.`,
    rTitle: 'العنوان', rPriority: 'الأولوية', rLocation: 'الموقع',
    rApartment: 'الشقة', rDescription: 'الوصف',
  },
  issueDone: {
    subj: (t: string) => `تم حل المشكلة: ${t}`,
    title: 'تم حل المشكلة التي أبلغت عنها',
    rNotes: 'ملاحظات',
  },
  charge: {
    subj: (d: string) => `مصروف جديد: ${d}`,
    fallback: 'مصروف',
    title: 'تمت إضافة مصروف جديد',
    intro: 'تمت إضافة مصروف جديد إلى حساب شقتك.',
    rDescription: 'الوصف', rCategory: 'الفئة', rAmount: 'المبلغ',
  },
  paid: {
    subj: 'تم استلام الدفعة',
    title: 'تم تسجيل الدفعة',
    intro: 'سجّلنا دفعتك. شكراً لك.',
    rAmount: 'المبلغ', rPaidAs: 'دُفعت كـ', rMethod: 'الطريقة', rDate: 'التاريخ',
  },
  paidEdit: {
    subj: 'تم تعديل دفعتك',
    title: 'تم تعديل الدفعة',
    intro: 'تم تعديل دفعة في حسابك.',
    rNewAmount: 'المبلغ الجديد', rDate: 'التاريخ',
  },
  paidGone: {
    subj: 'تم حذف دفعة',
    title: 'تم حذف الدفعة',
    intro: (amt: string) => `تم حذف دفعة بقيمة <strong>${amt}</strong> من حسابك.`,
  },
  transfer: {
    rUnit: 'الشقة', rAmount: 'المبلغ', rFormer: 'المستأجر السابق',
    ownerSubj: 'تم تحويل رصيد المستأجر السابق',
    ownerTitle: 'تم تحويل الرصيد إلى حساب المالك',
    ownerIntro: 'غادر مستأجر سابق وتم تحويل رصيده المتبقي إلى حساب المالك.',
    tenantSubj: 'تم تحويل رصيدك عند المغادرة',
    tenantTitle: 'تم تحويل الرصيد إلى مالك الشقة',
    tenantIntro: 'عند المغادرة، تم تحويل رصيدك المتبقي على هذه الشقة إلى حساب المالك.',
  },
  dues: {
    subj: (p: string, a: string) => `الموازنة المسبقة لـ ${p}: ${a}`,
    title: 'صدرت الموازنة المسبقة',
    intro: (p: string) => `موازنتك المسبقة لـ <strong>${p}</strong> جاهزة.`,
    rFor: 'عن', rAmountDue: 'المبلغ المستحق', rDueDate: 'تاريخ الاستحقاق',
    editSubj: (p: string) => `تم تعديل الموازنة: ${p}`,
    editTitle: 'تم تعديل الموازنة المسبقة',
    editIntro: (p: string) => `تم تعديل موازنتك المسبقة لـ <strong>${p}</strong>.`,
    rNewAmount: 'المبلغ الجديد',
    goneSubj: (p: string) => `تم حذف الموازنة: ${p}`,
    goneTitle: 'تم حذف الموازنة المسبقة',
    goneIntro: (p: string) => `تم حذف موازنتك المسبقة لـ <strong>${p}</strong>.`,
  },
  request: {
    subj: (b: string, u: string) => `طلب دفع: ${b}، شقة ${u}`,
    title: 'طلب دفع',
    fallback: 'الرصيد المستحق',
    intro: (what: string, unit: string, amount: string) =>
      `<strong>${what}</strong> - على الشقة <strong>${unit}</strong> تسوية <strong style="color:#dc2626;">${amount}</strong>.`,
    rAmount: 'المبلغ', rDueBy: 'الاستحقاق قبل',
  },
  invite: {
    subj: (u: string, b: string) => `دعوة إلى شقة: ${u} في ${b}`,
    title: 'تمت دعوتك إلى شقة',
    intro: (who: string) => `وردت دعوة من ${who} لربط حسابك بشقة. لا يحدث شيء حتى توافق.`,
    defaultInviter: 'إدارة المبنى',
    rUnit: 'الشقة', rBuilding: 'المبنى', rAs: 'الصفة',
    hint: 'سجّل الدخول ووافق على الدعوة أو ارفضها من لوحتك.',
    cta: 'مراجعة الدعوة',
  },
  meeting: {
    subj: (t: string) => `📅 دعوة اجتماع: ${t}`,
    title: (t: string) => `أنت مدعو: ${t}`,
    intro: (b: string) => `تم تحديد موعد اجتماع في <strong>${b}</strong>.`,
    rDate: 'التاريخ', rTime: 'الوقت', rOnline: 'عبر الإنترنت', rNotes: 'ملاحظات',
    joinLink: 'رابط الانضمام',
    icsNote: '📎 مرفق دعوة تقويم (.ics).',
    cta: 'عرض في أبنية',
  },
  lost: {
    subj: (t: string) => `مفقودات: ${t}`,
    title: (t: string) => `عُثر على: ${t}`,
    intro: (b: string, w: string) => `أُضيف غرض جديد إلى المفقودات في <strong>${b}</strong>` + (w ? ` (مكان العثور: <strong>${w}</strong>)` : '') + `. تحقق إن كان لك.`,
    cta: 'فتح المفقودات',
  },
  vote: {
    subjOpen: (t: string) => `تصويت: ${t}`,
    titleOpen: (t: string) => `التصويت مفتوح: ${t}`,
    introOpen: (b: string, d: string) => `هناك تصويت مفتوح في <strong>${b}</strong> حتى <strong>${d}</strong>. شارك برأيك.`,
    oneClick: 'صوّت بنقرة واحدة - يمكنك تغيير صوتك في أي وقت قبل الإغلاق:',
    orApp: 'أو صوّت من التطبيق:',
    cta: 'أدلِ بصوتك',
    subjClosed: (t: string) => `أُغلق التصويت: ${t}`,
    titleClosed: (t: string) => `صدرت النتائج: ${t}`,
    introClosed: (b: string) => `أُغلق التصويت في <strong>${b}</strong>.`,
    ctaResults: 'عرض النتائج',
  },
};

// French typography: a no-break space ( ) before : ; ! ? - the same
// convention src/i18n/fr.json already follows, so an email reads the way the
// screens do instead of looking machine-translated.
const FR: Dict = {
  dir: 'ltr',
  footer: 'Vous recevez ce message parce que les notifications sont activées dans votre compte Abniyah.',
  ctaAccount: 'Voir mon compte',
  ctaIssue: "Voir l'incident",
  priority: { low: 'Basse', medium: 'Moyenne', urgent: '🔴 Urgente' },
  category: {
    water: 'Eau', electricity: 'Électricité', common_expenses: 'Charges communes',
    projects: 'Travaux', contracts: 'Contrats', fines: 'Amendes', other: 'Autre',
  },
  method: { cash: 'Espèces', bank_transfer: 'Virement bancaire', cheque: 'Chèque', other: 'Autre' },
  tenure: { owner: 'Propriétaire', tenant: 'Locataire' },
  whish: (n: string) => `Vous pouvez régler directement via <strong>Whish</strong> au <strong>${n}</strong>.`,

  billing: {
    trialSubj: (scope: string) => `Bienvenue sur Abniyah - votre essai de 30 jours pour ${scope} a commencé`,
    trialTitle: 'Votre essai a commencé',
    trialBody: (scope: string, d: string) =>
      `Tout est ouvert pour <strong>${scope}</strong> jusqu’au <strong>${d}</strong> : licences illimitées, toutes les fonctions, sans carte. Nous vous préviendrons avant la fin ; rien n’est débité tant que vous ne vous abonnez pas.`,
    invoiceSubj: (scope: string, amount: string) => `Facture pour ${scope} : ${amount}`,
    invoiceTitle: 'Facture émise',
    invoiceBody: (scope: string, amount: string, due: string, period: string) =>
      `Une facture de <strong>${amount}</strong> pour <strong>${scope}</strong> (${period}) est prête. Réglez-la depuis la page Facturation avant le <strong>${due}</strong> - Whish ou carte.`,
    receiptSubj: (scope: string, amount: string) => `Paiement reçu pour ${scope} : ${amount}`,
    receiptTitle: 'Paiement reçu',
    receiptBody: (scope: string, amount: string, period: string) =>
      `Merci - <strong>${amount}</strong> reçus pour <strong>${scope}</strong> (${period}). Votre abonnement est actif ; le reçu est sur la page Facturation.`,
    cta: 'Ouvrir la facturation',
  },
  reg: {
    subj: "Nouvelle inscription de résident en attente d'approbation",
    title: 'Nouvelle inscription de résident',
    intro: "Un nouveau résident s'est inscrit et attend votre approbation.",
    name: 'Nom', apartment: 'Lot', phone: 'Téléphone',
    cta: "Examiner l'inscription",
  },
  issue: {
    subj: (t: string) => `Nouvel incident signalé : ${t}`,
    title: 'Nouvel incident signalé',
    intro: (b: string) => `Un nouvel incident a été enregistré à <strong>${b}</strong>.`,
    rTitle: 'Objet', rPriority: 'Priorité', rLocation: 'Emplacement',
    rApartment: 'Lot', rDescription: 'Description',
  },
  issueDone: {
    subj: (t: string) => `Incident résolu : ${t}`,
    title: 'Votre incident a été résolu',
    rNotes: 'Notes',
  },
  charge: {
    subj: (d: string) => `Nouvelle charge : ${d}`,
    fallback: 'Charge',
    title: 'Nouvelle charge ajoutée',
    intro: 'Une nouvelle charge a été ajoutée au compte de votre lot.',
    rDescription: 'Description', rCategory: 'Catégorie', rAmount: 'Montant',
  },
  paid: {
    subj: 'Paiement reçu',
    title: 'Paiement enregistré',
    intro: 'Nous avons enregistré votre paiement. Merci.',
    rAmount: 'Montant', rPaidAs: 'Réglé en', rMethod: 'Mode de règlement', rDate: 'Date',
  },
  paidEdit: {
    subj: 'Votre paiement a été modifié',
    title: 'Paiement modifié',
    intro: 'Un paiement sur votre compte a été modifié.',
    rNewAmount: 'Nouveau montant', rDate: 'Date',
  },
  paidGone: {
    subj: 'Un paiement a été supprimé',
    title: 'Paiement supprimé',
    intro: (amt: string) => `Un paiement de <strong>${amt}</strong> a été supprimé de votre compte.`,
  },
  transfer: {
    rUnit: 'Lot', rAmount: 'Montant', rFormer: 'Ancien locataire',
    ownerSubj: "Solde transféré depuis l'ancien locataire",
    ownerTitle: 'Solde transféré au compte du propriétaire',
    ownerIntro: "Un ancien locataire a quitté le lot et son solde restant a été transféré au compte du propriétaire.",
    tenantSubj: 'Votre solde a été transféré à votre départ',
    tenantTitle: 'Solde transféré au propriétaire du lot',
    tenantIntro: 'À votre départ, votre solde restant sur ce lot a été transféré au compte du propriétaire.',
  },
  dues: {
    subj: (p: string, a: string) => `Appel de fonds pour ${p} : ${a}`,
    title: 'Appel de fonds émis',
    intro: (p: string) => `Votre appel de fonds pour <strong>${p}</strong> est prêt.`,
    rFor: 'Objet', rAmountDue: 'Montant dû', rDueDate: "Date d'échéance",
    editSubj: (p: string) => `Appel de fonds modifié : ${p}`,
    editTitle: 'Appel de fonds modifié',
    editIntro: (p: string) => `Votre appel de fonds pour <strong>${p}</strong> a été modifié.`,
    rNewAmount: 'Nouveau montant',
    goneSubj: (p: string) => `Appel de fonds supprimé : ${p}`,
    goneTitle: 'Appel de fonds supprimé',
    goneIntro: (p: string) => `Votre appel de fonds pour <strong>${p}</strong> a été supprimé.`,
  },
  request: {
    subj: (b: string, u: string) => `Demande de paiement : ${b}, lot ${u}`,
    title: 'Demande de paiement',
    fallback: 'Solde à régler',
    intro: (what: string, unit: string, amount: string) =>
      `<strong>${what}</strong> - le lot <strong>${unit}</strong> a <strong style="color:#dc2626;">${amount}</strong> à régler.`,
    rAmount: 'Montant', rDueBy: 'À régler avant le',
  },
  invite: {
    subj: (u: string, b: string) => `Invitation à un lot : ${u} à ${b}`,
    title: 'Vous avez été invité à un lot',
    intro: (who: string) => `${who} souhaite associer votre compte à un lot. Rien ne se passe tant que vous n'avez pas accepté.`,
    defaultInviter: "La gestion de l'immeuble",
    rUnit: 'Lot', rBuilding: 'Immeuble', rAs: 'En tant que',
    hint: "Connectez-vous et acceptez ou refusez l'invitation depuis votre tableau de bord.",
    cta: "Examiner l'invitation",
  },
  meeting: {
    subj: (t: string) => `📅 Convocation à une réunion : ${t}`,
    title: (t: string) => `Vous êtes invité : ${t}`,
    intro: (b: string) => `Une réunion a été programmée à <strong>${b}</strong>.`,
    rDate: 'Date', rTime: 'Heure', rOnline: 'En ligne', rNotes: 'Notes',
    joinLink: 'Lien de connexion',
    icsNote: '📎 Une invitation calendrier (.ics) est jointe.',
    cta: 'Voir dans Abniyah',
  },
  lost: {
    subj: (t: string) => `Objets trouvés : ${t}`,
    title: (t: string) => `Objet trouvé : ${t}`,
    intro: (b: string, w: string) => `Un nouvel objet a été déposé aux objets trouvés à <strong>${b}</strong>` + (w ? ` (trouvé : <strong>${w}</strong>)` : '') + `. Vérifiez s'il est à vous.`,
    cta: 'Ouvrir les objets trouvés',
  },
  vote: {
    subjOpen: (t: string) => `Vote : ${t}`,
    titleOpen: (t: string) => `Le vote est ouvert : ${t}`,
    introOpen: (b: string, d: string) => `Un vote est ouvert à <strong>${b}</strong> jusqu'au <strong>${d}</strong>. Donnez votre avis.`,
    oneClick: 'Votez en un clic - modifiable à tout moment avant la clôture :',
    orApp: 'Ou votez dans l\'application :',
    cta: 'Voter',
    subjClosed: (t: string) => `Vote clos : ${t}`,
    titleClosed: (t: string) => `Les résultats sont là : ${t}`,
    introClosed: (b: string) => `Le vote est clos à <strong>${b}</strong>.`,
    ctaResults: 'Voir les résultats',
  },
};

const DICT: Record<Lang, Dict> = { en: EN, ar: AR, fr: FR };

// ── Main handler (Supabase Database Webhook payloads) ─────────────────────────
Deno.serve(async (req) => {
  try {
    if (WEBHOOK_SECRET && req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const { type, table: tbl, record, old_record } = await req.json();
    // names the payload, so a webhook landing on a handler that does not exist
    // is visible instead of looking like a no-op boot
    console.log(`[hook] ${tbl}.${type}`);

    // 1. New resident registered → admins
    if (tbl === 'profiles' && type === 'INSERT' && record.status === 'pending' && record.building_id) {
      const b = await getBuilding(record.building_id);
      await emailToUserIds(
        await buildingAdminIds(record.building_id),
        (L) => ({
          subject: L.reg.subj,
          html: emailHtml(L, L.reg.title,
            `<p style="color:#475569;font-size:14px;line-height:1.6;">${L.reg.intro}</p>
             ${table(row(L.reg.name, esc(record.full_name)) + row(L.reg.apartment, esc(record.apartment_number ?? '-')) + row(L.reg.phone, esc(record.phone ?? '-')))}`,
            L.reg.cta, `${APP_URL}/users`),
        }),
        b?.name ?? 'Abniyah');
    }

    // 2. (removed 2026-08-26) The "resident approved" email is gone: activation
    //    now happens when the invitee accepts and signs in themselves - mailing
    //    them "you have been approved" at that moment was redundant, and on
    //    imports it fired with building '-'. The invitation email (Supabase
    //    Auth template) is the one and only onboarding email.

    // 3. New issue → admins (excluding reporter)
    if (tbl === 'issues' && type === 'INSERT') {
      const b = await getBuilding(record.building_id);
      const admins = (await buildingAdminIds(record.building_id)).filter((id) => id !== record.reported_by);
      await emailToUserIds(admins, (L) => ({
        subject: L.issue.subj(record.title),
        html: emailHtml(L, L.issue.title,
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">${L.issue.intro(esc(b?.name ?? '-'))}</p>
           ${table(row(L.issue.rTitle, esc(record.title)) + row(L.issue.rPriority, esc(L.priority[record.priority] ?? record.priority)) + row(L.issue.rLocation, esc(record.location ?? '-')) + (record.apartment_number ? row(L.issue.rApartment, esc(record.apartment_number)) : '') + row(L.issue.rDescription, esc(record.description ?? '-')))}`,
          L.ctaIssue, `${APP_URL}/issues`),
      }), b?.name ?? 'Abniyah');
    }

    // 3b. Issue resolved → reporter
    if (tbl === 'issues' && type === 'UPDATE' && old_record?.status !== 'resolved' && record.status === 'resolved') {
      const b = await getBuilding(record.building_id);
      await emailToUserIds([record.reported_by], (L) => ({
        subject: L.issueDone.subj(record.title),
        html: emailHtml(L, L.issueDone.title,
          `<p style="color:#475569;font-size:14px;line-height:1.6;">${esc(record.title)}</p>
           ${record.resolution_notes ? table(row(L.issueDone.rNotes, esc(record.resolution_notes))) : ''}`,
          L.ctaIssue, `${APP_URL}/issues`),
      }), b?.name ?? 'Abniyah');
    }

    // 4. New charge (v3 finance) → the BILLED party only (owner or tenant)
    // 0121 (finance audit H4): notify_suppressed marks a charge written by
    // repost_expense()/repost_metered_expense() - a re-post of an EXISTING
    // expense, not a new one. Without this, fixing a typo on an expense
    // re-fired this exact email to every resident on it.
    // (changed 2026-08-29, Jey's QA) New-charge external pings are OFF: a
    // charge is a ledger line, not an ask - "pay via whish" belongs to
    // payment REQUESTS and prepaid asks, which keep their email/WhatsApp.
    // The in-app bell still fires per charge (DB trigger, 0009/0067).
    if (tbl === 'charges' && type === 'INSERT') {
      // intentionally silent
    }

    // 5. Payment recorded (v3 finance) → the PAYING party only (receipt)
    if (tbl === 'payments' && type === 'INSERT') {
      const b = await getBuilding(record.building_id);
      const payRecipients = await unitPartyIds(record.unit_id, record.paid_by === 'tenant' ? 'tenant' : 'owner', record.tenant_id);
      await emailToUserIds(payRecipients, (L) => ({
        subject: L.paid.subj,
        html: emailHtml(L, L.paid.title,
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">${L.paid.intro}</p>
           ${table(row(L.paid.rAmount, money(record.amount_usd)) + (lbpNote(record) ? row(L.paid.rPaidAs, esc(lbpNote(record)!)) : '') + row(L.paid.rMethod, esc(L.method[record.method] ?? record.method)) + row(L.paid.rDate, esc(record.paid_on)))}`,
          L.ctaAccount, `${APP_URL}/finance`),
      }), b?.name ?? 'Abniyah');
      const { data: payUnit } = await supabase.from('units').select('label').eq('id', record.unit_id).single();
      await whatsappToUserIds(payRecipients, 'abniyah_payment_received',
        (name) => [name, money(record.amount_usd), payUnit?.label ?? '-', b?.name ?? '-']);
    }

    // 5b. Payment edited (amount changed) → the paying party only
    if (tbl === 'payments' && type === 'UPDATE' && record.amount_usd !== old_record?.amount_usd) {
      const b = await getBuilding(record.building_id);
      await emailToUserIds(
        await unitPartyIds(record.unit_id, record.paid_by === 'tenant' ? 'tenant' : 'owner', record.tenant_id),
        (L) => ({
          subject: L.paidEdit.subj,
          html: emailHtml(L, L.paidEdit.title,
            `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">${L.paidEdit.intro}</p>
             ${table(row(L.paidEdit.rNewAmount, money(record.amount_usd)) + row(L.paidEdit.rDate, esc(record.paid_on)))}`,
            L.ctaAccount, `${APP_URL}/finance`),
        }), b?.name ?? 'Abniyah');
    }

    // 5c. Payment removed → the paying party only  (DELETE payloads carry old_record)
    if (tbl === 'payments' && type === 'DELETE' && old_record) {
      const b = await getBuilding(old_record.building_id);
      await emailToUserIds(
        await unitPartyIds(old_record.unit_id, old_record.paid_by === 'tenant' ? 'tenant' : 'owner', old_record.tenant_id),
        (L) => ({
          subject: L.paidGone.subj,
          html: emailHtml(L, L.paidGone.title,
            `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">${L.paidGone.intro(money(old_record.amount_usd))}</p>`,
            L.ctaAccount, `${APP_URL}/finance`),
        }), b?.name ?? 'Abniyah');
    }

    // 5c-ii. Move-out offload (transfer) → BOTH the owner and the former tenant.
    //   end_membership() inserts a PAIR of transfer rows; drive off the
    //   TENANT-party row so each side gets exactly one email. Requires a
    //   Database Webhook on `adjustments` INSERT (see docs/DEPENDENCIES.md).
    //   NOTE: no WhatsApp here - that needs a new approved Meta template
    //   (existing template param counts are frozen); email + in-app cover it.
    if (tbl === 'adjustments' && type === 'INSERT'
        && (record.kind === 'transfer_in' || record.kind === 'transfer_out') && record.party === 'tenant') {
      const b = await getBuilding(record.building_id);
      const { data: adjUnit } = await supabase.from('units').select('label').eq('id', record.unit_id).single();
      const detail = (L: Dict) => table(
        row(L.transfer.rUnit, esc(adjUnit?.label ?? '-')) +
        row(L.transfer.rAmount, money(record.amount_usd)) +
        (record.counterparty_name ? row(L.transfer.rFormer, esc(record.counterparty_name)) : ''));
      await emailToUserIds(await unitPartyIds(record.unit_id, 'owner'), (L) => ({
        subject: L.transfer.ownerSubj,
        html: emailHtml(L, L.transfer.ownerTitle,
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">${L.transfer.ownerIntro}</p>${detail(L)}`,
          L.ctaAccount, `${APP_URL}/finance`),
      }), b?.name ?? 'Abniyah');
      if (record.tenant_id) {
        await emailToUserIds([record.tenant_id], (L) => ({
          subject: L.transfer.tenantSubj,
          html: emailHtml(L, L.transfer.tenantTitle,
            `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">${L.transfer.tenantIntro}</p>${detail(L)}`,
            L.ctaAccount, `${APP_URL}/finance`),
        }), b?.name ?? 'Abniyah');
      }
    }

    // 5d. Dues issued → the BILLED party only (0070).
    //     Dues used to fan to every membership on the unit; once they carry
    //     billed_to + tenant_id a tenant's dues must not reach the owner, and a
    //     former tenant must not hear about the current period at all.
    //     ⚠️ WhatsApp param count stays 6 - only the recipients changed.
    if (tbl === 'dues' && type === 'INSERT') {
      const b = await getBuilding(record.building_id);
      const duesParty = record.billed_to === 'tenant' ? 'tenant' : 'owner';
      const duesTo = await unitPartyIds(record.unit_id, duesParty, record.tenant_id);
      const what = record.kind === 'off_budget' && record.label ? esc(record.label) : null;
      await emailToUserIds(duesTo, (L) => ({
        subject: L.dues.subj(record.period_label, money(record.amount_due)),
        html: emailHtml(L, L.dues.title,
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">${L.dues.intro(esc(record.period_label))}</p>
           ${table(
             (what ? row(L.dues.rFor, what) : '') +
             row(L.dues.rAmountDue, money(record.amount_due)) +
             (record.due_date ? row(L.dues.rDueDate, esc(record.due_date)) : ''))}`,
          L.ctaAccount, `${APP_URL}/finance`),
      }), b?.name ?? 'Abniyah');
      const { data: duesUnit } = await supabase.from('units').select('label').eq('id', record.unit_id).single();
      await whatsappToUserIds(duesTo, 'abniyah_dues_issued',
        (name, lang) => {
          const base = [name, record.period_label, money(record.amount_due), duesUnit?.label ?? '-', b?.name ?? '-'];
          return WHATSAPP_PER_LANG ? [...base, payLine(lang, b?.whish_number)] : base;
        });
    }

    // 5e. Dues edited (amount changed) → the *effective* billed party only.
    //   D14: a departed tenant's dues offload to the owner - resolve recipients
    //   through effective_obligation_party (as 5f-ii does) so the owner, now
    //   silently carrying it, is the one told. D9/D10: skip a suppressed edit.
    if (tbl === 'dues' && type === 'UPDATE' && record.amount_due !== old_record?.amount_due && !record.notify_suppressed) {
      const b = await getBuilding(record.building_id);
      const { data: eff5e } = await supabase.rpc('effective_obligation_party', {
        p_unit: record.unit_id, p_billed_to: record.billed_to, p_tenant: record.tenant_id,
      });
      await emailToUserIds(
        await unitPartyIds(record.unit_id, eff5e === 'tenant' ? 'tenant' : 'owner', record.tenant_id),
        (L) => ({
          subject: L.dues.editSubj(record.period_label),
          html: emailHtml(L, L.dues.editTitle,
            `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">${L.dues.editIntro(esc(record.period_label))}</p>
             ${table(row(L.dues.rNewAmount, money(record.amount_due)) + (record.due_date ? row(L.dues.rDueDate, esc(record.due_date)) : ''))}`,
            L.ctaAccount, `${APP_URL}/finance`),
        }), b?.name ?? 'Abniyah');
    }

    // 5f. Dues removed → the *effective* billed party only.
    //   D14: offload to the owner for a departed tenant (see 5e). D9/D10: a
    //   suppressed delete (purge cascade 0144 / budget cancel 0145) stays silent.
    if (tbl === 'dues' && type === 'DELETE' && old_record && !old_record.notify_suppressed) {
      const b = await getBuilding(old_record.building_id);
      const { data: eff5f } = await supabase.rpc('effective_obligation_party', {
        p_unit: old_record.unit_id, p_billed_to: old_record.billed_to, p_tenant: old_record.tenant_id,
      });
      await emailToUserIds(
        await unitPartyIds(old_record.unit_id, eff5f === 'tenant' ? 'tenant' : 'owner', old_record.tenant_id),
        (L) => ({
          subject: L.dues.goneSubj(old_record.period_label),
          html: emailHtml(L, L.dues.goneTitle,
            `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">${L.dues.goneIntro(esc(old_record.period_label))}</p>`,
            L.ctaAccount, `${APP_URL}/finance`),
        }), b?.name ?? 'Abniyah');
    }

    // 5f-ii. Payment request issued (0076/0077) → the billed party only.
    //   Needs a Database Webhook on `payment_request_lines` INSERT, or only the
    //   in-app bell fires (same footgun as the adjustments webhook).
    //   ⚠️ Reuses abniyah_payment_reminder - param count stays 5 with payLine.
    if (tbl === 'payment_request_lines' && type === 'INSERT') {
      const { data: pr } = await supabase.from('payment_requests')
        .select('label, due_date').eq('id', record.request_id).single();
      const b = await getBuilding(record.building_id);
      const { data: prUnit } = await supabase.from('units').select('label').eq('id', record.unit_id).single();
      // a line offloaded to the owner must reach the owner, not a departed tenant
      const { data: effParty } = await supabase.rpc('effective_obligation_party', {
        p_unit: record.unit_id, p_billed_to: record.party, p_tenant: record.tenant_id,
      });
      const party = effParty === 'tenant' ? 'tenant' : 'owner';
      const to = await unitPartyIds(record.unit_id, party, record.tenant_id);
      const amount = money(record.amount_requested);
      await emailToUserIds(to, (L) => {
        // the request's own label when it has one, else the generic phrase in
        // the reader's language - an untranslated fallback was the giveaway
        const what = pr?.label ? esc(pr.label) : L.request.fallback;
        return {
          subject: L.request.subj(b?.name ?? 'Abniyah', prUnit?.label ?? ''),
          html: emailHtml(L, L.request.title,
            `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">
               ${L.request.intro(what, esc(prUnit?.label ?? ''), amount)}</p>
             ${table(row(L.request.rAmount, amount) + (pr?.due_date ? row(L.request.rDueBy, esc(pr.due_date)) : ''))}`,
            L.ctaAccount, `${APP_URL}/finance`),
        };
      }, b?.name ?? 'Abniyah');
      await whatsappToUserIds(to, 'abniyah_payment_reminder',
        (name, lang) => {
          const base = [name, amount, prUnit?.label ?? '-', b?.name ?? '-'];
          return WHATSAPP_PER_LANG ? [...base, payLine(lang, b?.whish_number)] : base;
        });
    }

    // 5g. Unit invitation (consent flow, 0053) → the invited person.
    //     Membership is only created when they accept in the app.
    if (tbl === 'membership_invites' && type === 'INSERT' && record.status === 'pending') {
      const { data: unit } = await supabase.from('units').select('label, building_id').eq('id', record.unit_id).single();
      const b = unit ? await getBuilding(unit.building_id) : null;
      const { data: inviter } = record.invited_by
        ? await supabase.from('profiles').select('full_name').eq('id', record.invited_by).single()
        : { data: null };
      await emailToUserIds([record.user_id], (L) => ({
        subject: L.invite.subj(unit?.label ?? '', b?.name ?? '-'),
        html: emailHtml(L, L.invite.title,
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">${L.invite.intro(esc(inviter?.full_name ?? L.invite.defaultInviter))}</p>
           ${table(row(L.invite.rUnit, esc(unit?.label ?? '-')) + row(L.invite.rBuilding, esc(b?.name ?? '-')) + row(L.invite.rAs, esc(L.tenure[record.tenure] ?? record.tenure)))}
           <p style="color:#64748b;font-size:13px;margin-top:16px;">${L.invite.hint}</p>`,
          L.invite.cta, `${APP_URL}/dashboard`),
      }), b?.name ?? 'Abniyah');
      await whatsappToUserIds([record.user_id], 'abniyah_unit_invite',
        (name) => [name, inviter?.full_name ?? 'A building admin', unit?.label ?? '-', b?.name ?? '-']);
    }

    // 6. Scheduled meeting → all building residents (+ .ics)
    // ── Billing (0114): trial started / invoice issued / payment received ──
    if (tbl === 'subscriptions' && type === 'INSERT' && record.status === 'trial') {
      const scope = await subscriptionScopeName(record);
      const ids = await subscriptionAdminIds(record);
      await emailToUserIds(ids, (L) => ({
        subject: L.billing.trialSubj(scope),
        html: emailHtml(L, L.billing.trialTitle,
          `<p style="color:#475569;font-size:14px;line-height:1.6;">${L.billing.trialBody(esc(scope), String(record.trial_ends_at).slice(0, 10))}</p>`,
          L.billing.cta, `${APP_URL}/licenses`),
      }));
      return json({ ok: true });
    }
    if (tbl === 'invoices' && (type === 'INSERT' || (type === 'UPDATE' && old_record?.status !== 'paid' && record.status === 'paid'))) {
      const { data: sub } = await supabase.from('subscriptions').select('*').eq('id', record.subscription_id).single();
      if (sub) {
        const scope = await subscriptionScopeName(sub);
        const ids = await subscriptionAdminIds(sub);
        const period = `${record.period_start} → ${record.period_end}`;
        // 0117 pay-first: invoices are born already paid - an INSERT with
        // status 'paid' is a receipt, not an "invoice issued".
        const isReceipt = type === 'UPDATE' || record.status === 'paid';
        await emailToUserIds(ids, (L) => ({
          subject: isReceipt ? L.billing.receiptSubj(scope, centsFmt(record.amount_cents)) : L.billing.invoiceSubj(scope, centsFmt(record.amount_cents)),
          html: emailHtml(L, isReceipt ? L.billing.receiptTitle : L.billing.invoiceTitle,
            `<p style="color:#475569;font-size:14px;line-height:1.6;">${isReceipt
              ? L.billing.receiptBody(esc(scope), centsFmt(record.amount_cents), period)
              : L.billing.invoiceBody(esc(scope), centsFmt(record.amount_cents), record.due_date ?? '', period)}</p>`,
            L.billing.cta, `${APP_URL}/licenses`),
        }));
      }
      return json({ ok: true });
    }

    if (tbl === 'meetings' && type === 'INSERT' && record.meeting_type === 'scheduled') {
      const b = await getBuilding(record.building_id);
      const ics = b ? generateIcs(record.id, record.title, record.meeting_date, record.meeting_time ?? null, record.summary ?? '', b) : null;
      const meetingHref = safeUrl(record.meeting_url);
      await emailToUserIds(await buildingResidentIds(record.building_id), (L) => {
        const joinRow = meetingHref ? row(L.meeting.rOnline, `<a href="${esc(meetingHref)}">${L.meeting.joinLink}</a>`) : '';
        return {
          subject: L.meeting.subj(record.title),
          html: emailHtml(L, L.meeting.title(esc(record.title)),
            `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">${L.meeting.intro(esc(b?.name ?? '-'))}</p>
             ${table(row(L.meeting.rDate, esc(record.meeting_date)) + (record.meeting_time ? row(L.meeting.rTime, esc(record.meeting_time.slice(0, 5))) : '') + joinRow + (record.summary ? row(L.meeting.rNotes, esc(record.summary)) : ''))}
             <p style="color:#64748b;font-size:13px;margin-top:16px;">${L.meeting.icsNote}</p>`,
            L.meeting.cta, `${APP_URL}/meetings`),
        };
      }, b?.name ?? 'Abniyah',
        ics ? [{ filename: 'meeting-invite.ics', content: toBase64(ics) }] : undefined);
    }

    // ── Lost & found (0154): a new item -> email + push to the whole
    //    building, except the poster. The in-app bell already fired via the
    //    DB trigger - one alert per channel, no doubling.
    if (tbl === 'lost_items' && type === 'INSERT') {
      const b = await getBuilding(record.building_id);
      const ids = (await buildingResidentIds(record.building_id)).filter((id) => id !== record.created_by);
      await emailToUserIds(ids, (L) => ({
        subject: L.lost.subj(record.title),
        html: emailHtml(L, L.lost.title(esc(record.title)),
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">${L.lost.intro(esc(b?.name ?? '-'), record.found_where ? esc(record.found_where) : '')}</p>`,
          L.lost.cta, `${APP_URL}/lost-found`),
      }), b?.name ?? 'Abniyah');
    }

    // ── Voting (0155/0168): open -> email+push with one-click option links
    //    (single-choice polls; multi-choice link to the app). Close -> the
    //    results email. Bells were already sent by the 0155 triggers.
    if (tbl === 'polls' && (type === 'INSERT'
        || (type === 'UPDATE' && old_record?.status === 'open' && record.status === 'closed'))) {
      const opened = type === 'INSERT';
      const scopeBuildings: string[] = record.building_id ? [record.building_id]
        : ((await supabase.from('buildings').select('id').eq('compound_id', record.compound_id)).data ?? []).map((b: { id: string }) => b.id);
      const b = record.building_id ? await getBuilding(record.building_id) : null;
      const cname = record.compound_id
        ? ((await supabase.from('compounds').select('name').eq('id', record.compound_id).single()).data?.name ?? '-') : null;
      const scopeName = cname ?? b?.name ?? '-';
      const idSets = await Promise.all(scopeBuildings.map((id) => buildingResidentIds(id)));
      const ids = [...new Set(idSets.flat())].filter((id) => id !== record.created_by);
      const closesText = String(record.closes_at ?? '').slice(0, 16).replace('T', ' ');

      if (opened) {
        // the app inserts the poll row FIRST and its options a beat later,
        // while the webhook fires instantly - wait for the options so the
        // one-click buttons actually make it into the email
        let options: { id: string; label: string }[] = [];
        for (let attempt = 0; attempt < 8 && options.length === 0; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
          const { data: opts } = await supabase.from('poll_options')
            .select('id, label').eq('poll_id', record.id).order('position');
          options = (opts ?? []) as { id: string; label: string }[];
        }
        const oneClick = record.choice_type === 'single' && options.length > 0;
        await emailToUserIds(ids, async (L, uid) => {
          let optionsHtml = '';
          if (oneClick && uid) {
            const links = await Promise.all(options.map(async (op) => {
              const sig = await voteLinkSig(uid, record.id, op.id);
              const href = `${SUPABASE_FN_URL}/vote-click?u=${uid}&p=${record.id}&o=${op.id}&s=${sig}`;
              return `<a href="${href}" style="display:block;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:11px 16px;margin:0 0 8px;color:#0f172a;text-decoration:none;font-size:14px;font-weight:600;">${esc(op.label)}</a>`;
            }));
            optionsHtml = `<p style="color:#64748b;font-size:13px;margin:16px 0 8px;">${L.vote.oneClick}</p>${links.join('')}
              <p style="color:#94a3b8;font-size:12px;margin:12px 0 0;">${L.vote.orApp}</p>`;
          }
          return {
            subject: L.vote.subjOpen(record.title),
            html: emailHtml(L, L.vote.titleOpen(esc(record.title)),
              `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">${L.vote.introOpen(esc(scopeName), esc(closesText))}</p>
               ${record.description ? `<p style="color:#64748b;font-size:13px;margin:0 0 4px;">${esc(record.description)}</p>` : ''}
               ${optionsHtml}`,
              L.vote.cta, `${APP_URL}/voting`),
          };
        }, scopeName);
      } else {
        await emailToUserIds(ids, (L) => ({
          subject: L.vote.subjClosed(record.title),
          html: emailHtml(L, L.vote.titleClosed(esc(record.title)),
            `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">${L.vote.introClosed(esc(scopeName))}</p>`,
            L.vote.ctaResults, `${APP_URL}/voting`),
        }), scopeName);
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error('Notify error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
