import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL = Deno.env.get('FROM_EMAIL')!;
const APP_URL = Deno.env.get('APP_URL')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// service-role client → bypasses RLS, can read grants/memberships/profiles freely
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Optional shared secret: when the WEBHOOK_SECRET env var is set, requests must
// carry the same value in the x-webhook-secret header (configure it on every
// Database Webhook). Unset = legacy open behavior, so enabling is a two-step
// opt-in that can't break email delivery by accident.
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') ?? '';

// Record fields are attacker-influenced text — escape before interpolating into HTML.
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

async function sendEmail(to: string, subject: string, html: string, fromName?: string, attachments?: Attachment[]) {
  const from = fromName ? `"${fromName}" <${FROM_EMAIL}>` : FROM_EMAIL;
  const body: Record<string, unknown> = { from, to, subject, html };
  if (attachments?.length) body.attachments = attachments;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error('Resend error:', await res.text());
}

function emailHtml(title: string, bodyHtml: string, ctaLabel: string, ctaUrl: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
  <body style="margin:0;padding:0;background:#f5f6f8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
        <tr><td style="background:#4f46e5;padding:20px 32px;">
          <p style="margin:0;color:#fff;font-size:18px;font-weight:700;">BuildingHub</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 16px;font-size:18px;color:#0f172a;font-weight:600;">${title}</h2>
          ${bodyHtml}
          <div style="margin-top:28px;">
            <a href="${ctaUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 24px;border-radius:10px;font-size:14px;font-weight:600;">${ctaLabel}</a>
          </div>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #f1f5f9;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">You received this because you have email notifications enabled in BuildingHub.</p>
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

// ── WhatsApp primitives (Meta Cloud API) ─────────────────────────────────────
// Disabled until both secrets are set — same two-step opt-in as WEBHOOK_SECRET,
// so deploying this code changes nothing until the Meta account is ready.
// Template names below must match the pre-approved templates in Meta Business
// Manager EXACTLY (name + variable count/order) — see docs/WHATSAPP_SETUP.md.
const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_TOKEN') ?? '';
const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID') ?? '';
const WHATSAPP_LANG = Deno.env.get('WHATSAPP_LANG') || 'en';
// Per-language templates (0060): OFF = legacy bilingual bodies (params doubled,
// single language code). Flip to '1' ONLY after the per-language template
// variants are approved in Meta — see docs/WHATSAPP_SETUP.md Part 2b.
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
const waParam = (v: unknown) => (String(v ?? '').replace(/\s+/g, ' ').trim() || '—');

async function sendWhatsApp(toPhone: string, templateName: string, params: string[], lang: WaLang = 'en') {
  // Legacy mode: templates are BILINGUAL — an Arabic section ({{1}}..{{n}})
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
 *  removing an owner CLOSES the membership (kept for financial history) — closed
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
  if (party === 'tenant' && tenantId && ids.includes(tenantId)) return [tenantId];
  return ids;
}

/** everyone living in a building: memberships ∪ legacy profiles.building_id */
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

/** send the same email to a set of users, honoring their notify_email preference */
async function emailToUserIds(ids: string[], subject: string, html: string, fromName?: string, attachments?: Attachment[]) {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return;
  const { data: profs } = await supabase.from('profiles').select('id, notify_email').in('id', uniq);
  for (const p of (profs ?? []) as { id: string; notify_email: boolean }[]) {
    if (!p.notify_email) continue;
    const email = await getUserEmail(p.id);
    if (email) await sendEmail(email, subject, html, fromName, attachments);
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
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BuildingHub//EN', 'CALSCALE:GREGORIAN', 'METHOD:REQUEST',
    'BEGIN:VEVENT', `UID:${uid}@buildinghub`, `DTSTAMP:${now}`, dtstart, dtend,
    `SUMMARY:${title}`, `LOCATION:${location}`, desc,
    `ORGANIZER;CN="${building.name}":mailto:${FROM_EMAIL}`, 'STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

const PRIORITY_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', urgent: '🔴 Urgent' };
const CATEGORY_LABEL: Record<string, string> = {
  water: 'Water', electricity: 'Electricity', common_expenses: 'Common Expenses',
  projects: 'Projects', contracts: 'Contracts', fines: 'Fines', other: 'Other',
};
const METHOD_LABEL: Record<string, string> = { cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque', other: 'Other' };

// ── Main handler (Supabase Database Webhook payloads) ─────────────────────────
Deno.serve(async (req) => {
  try {
    if (WEBHOOK_SECRET && req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const { type, table: tbl, record, old_record } = await req.json();

    // 1. New resident registered → admins
    if (tbl === 'profiles' && type === 'INSERT' && record.status === 'pending' && record.building_id) {
      const b = await getBuilding(record.building_id);
      await emailToUserIds(
        await buildingAdminIds(record.building_id),
        'New resident registration awaiting approval',
        emailHtml('New resident registration',
          `<p style="color:#475569;font-size:14px;line-height:1.6;">A new resident has registered and is awaiting your approval.</p>
           ${table(row('Name', esc(record.full_name)) + row('Apartment', esc(record.apartment_number ?? '—')) + row('Phone', esc(record.phone ?? '—')))}`,
          'Review Registration', `${APP_URL}/users`),
        b?.name ?? 'BuildingHub');
    }

    // 2. Resident approved → the resident
    if (tbl === 'profiles' && type === 'UPDATE' && old_record?.status === 'pending' && record.status === 'active') {
      const b = await getBuilding(record.building_id);
      await emailToUserIds([record.id], 'Your registration has been approved',
        emailHtml(`Welcome, ${esc(record.full_name)}!`,
          `<p style="color:#475569;font-size:14px;line-height:1.6;">Your registration for <strong>${esc(b?.name ?? 'your building')}</strong> has been approved. You can now log in.</p>`,
          'Log In to BuildingHub', `${APP_URL}/`),
        b?.name ?? 'BuildingHub');
    }

    // 3. New issue → admins (excluding reporter)
    if (tbl === 'issues' && type === 'INSERT') {
      const b = await getBuilding(record.building_id);
      const admins = (await buildingAdminIds(record.building_id)).filter((id) => id !== record.reported_by);
      await emailToUserIds(admins, `New issue reported: ${record.title}`,
        emailHtml('New issue reported',
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">A new issue has been logged in <strong>${esc(b?.name ?? 'your building')}</strong>.</p>
           ${table(row('Title', esc(record.title)) + row('Priority', esc(PRIORITY_LABEL[record.priority] ?? record.priority)) + row('Location', esc(record.location ?? '—')) + (record.apartment_number ? row('Apartment', esc(record.apartment_number)) : '') + row('Description', esc(record.description ?? '—')))}`,
          'View Issue', `${APP_URL}/issues`),
        b?.name ?? 'BuildingHub');
    }

    // 3b. Issue resolved → reporter
    if (tbl === 'issues' && type === 'UPDATE' && old_record?.status !== 'resolved' && record.status === 'resolved') {
      const b = await getBuilding(record.building_id);
      await emailToUserIds([record.reported_by], `Issue resolved: ${record.title}`,
        emailHtml('Your issue has been resolved',
          `<p style="color:#475569;font-size:14px;line-height:1.6;">${esc(record.title)}</p>
           ${record.resolution_notes ? table(row('Notes', esc(record.resolution_notes))) : ''}`,
          'View Issue', `${APP_URL}/issues`),
        b?.name ?? 'BuildingHub');
    }

    // 4. New charge (v3 finance) → the BILLED party only (owner or tenant)
    if (tbl === 'charges' && type === 'INSERT') {
      const b = await getBuilding(record.building_id);
      // legacy billed_to='both' means owner; only 'tenant' routes to the tenant.
      const chargeRecipients = await unitPartyIds(record.unit_id, record.billed_to === 'tenant' ? 'tenant' : 'owner', record.tenant_id);
      await emailToUserIds(chargeRecipients, `New charge: ${record.description || 'Charge'}`,
        emailHtml('New charge added',
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">A new charge has been added to your unit's account.</p>
           ${table(row('Description', esc(record.description || '—')) + row('Category', esc(CATEGORY_LABEL[record.category] ?? record.category)) + row('Amount', money(record.amount_usd)))}
           ${b?.whish_number ? `<p style="color:#475569;font-size:14px;line-height:1.6;margin:12px 0 0;">You can pay directly through <strong>Whish</strong> to <strong>${esc(b.whish_number)}</strong>.</p>` : ''}`,
          'View My Account', `${APP_URL}/finance`),
        b?.name ?? 'BuildingHub');
      const { data: chargeUnit } = await supabase.from('units').select('label').eq('id', record.unit_id).single();
      await whatsappToUserIds(chargeRecipients, 'abniyah_new_charge',
        (name, lang) => {
          const base = [name, money(record.amount_usd), chargeUnit?.label ?? '—', b?.name ?? '—'];
          return WHATSAPP_PER_LANG ? [...base, payLine(lang, b?.whish_number)] : base;
        });
    }

    // 5. Payment recorded (v3 finance) → the PAYING party only (receipt)
    if (tbl === 'payments' && type === 'INSERT') {
      const b = await getBuilding(record.building_id);
      const payRecipients = await unitPartyIds(record.unit_id, record.paid_by === 'tenant' ? 'tenant' : 'owner', record.tenant_id);
      await emailToUserIds(payRecipients, 'Payment received, thank you',
        emailHtml('Payment recorded',
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">We've recorded your payment. Thank you.</p>
           ${table(row('Amount', money(record.amount_usd)) + row('Method', esc(METHOD_LABEL[record.method] ?? record.method)) + row('Date', esc(record.paid_on)))}`,
          'View My Account', `${APP_URL}/finance`),
        b?.name ?? 'BuildingHub');
      const { data: payUnit } = await supabase.from('units').select('label').eq('id', record.unit_id).single();
      await whatsappToUserIds(payRecipients, 'abniyah_payment_received',
        (name) => [name, money(record.amount_usd), payUnit?.label ?? '—', b?.name ?? '—']);
    }

    // 5b. Payment edited (amount changed) → the paying party only
    if (tbl === 'payments' && type === 'UPDATE' && record.amount_usd !== old_record?.amount_usd) {
      const b = await getBuilding(record.building_id);
      await emailToUserIds(await unitPartyIds(record.unit_id, record.paid_by === 'tenant' ? 'tenant' : 'owner', record.tenant_id), 'Your payment was updated',
        emailHtml('Payment updated',
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">A payment on your account was updated.</p>
           ${table(row('New amount', money(record.amount_usd)) + row('Date', record.paid_on))}`,
          'View My Account', `${APP_URL}/finance`),
        b?.name ?? 'BuildingHub');
    }

    // 5c. Payment removed → the paying party only  (DELETE payloads carry old_record)
    if (tbl === 'payments' && type === 'DELETE' && old_record) {
      const b = await getBuilding(old_record.building_id);
      await emailToUserIds(await unitPartyIds(old_record.unit_id, old_record.paid_by === 'tenant' ? 'tenant' : 'owner', old_record.tenant_id), 'A payment was removed',
        emailHtml('Payment removed',
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">A payment of <strong>${money(old_record.amount_usd)}</strong> was removed from your account.</p>`,
          'View My Account', `${APP_URL}/finance`),
        b?.name ?? 'BuildingHub');
    }

    // 5c-ii. Move-out offload (transfer) → BOTH the owner and the former tenant.
    //   end_membership() inserts a PAIR of transfer rows; drive off the
    //   TENANT-party row so each side gets exactly one email. Requires a
    //   Database Webhook on `adjustments` INSERT (see docs/DEPENDENCIES.md).
    //   NOTE: no WhatsApp here — that needs a new approved Meta template
    //   (existing template param counts are frozen); email + in-app cover it.
    if (tbl === 'adjustments' && type === 'INSERT'
        && (record.kind === 'transfer_in' || record.kind === 'transfer_out') && record.party === 'tenant') {
      const b = await getBuilding(record.building_id);
      const { data: adjUnit } = await supabase.from('units').select('label').eq('id', record.unit_id).single();
      const detail = table(row('Unit', esc(adjUnit?.label ?? '—')) + row('Amount', money(record.amount_usd)) + (record.counterparty_name ? row('Former tenant', esc(record.counterparty_name)) : ''));
      await emailToUserIds(await unitPartyIds(record.unit_id, 'owner'), 'Balance transferred from former tenant',
        emailHtml('Balance transferred to the owner account',
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">A former tenant moved out and their remaining balance was transferred to the owner account.</p>${detail}`,
          'View My Account', `${APP_URL}/finance`),
        b?.name ?? 'BuildingHub');
      if (record.tenant_id) {
        await emailToUserIds([record.tenant_id], 'Your balance was transferred on move-out',
          emailHtml('Balance transferred to the unit owner',
            `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">On move-out, your remaining balance on this unit was transferred to the owner account.</p>${detail}`,
            'View My Account', `${APP_URL}/finance`),
          b?.name ?? 'BuildingHub');
      }
    }

    // 5d. Dues issued → owner(s)
    if (tbl === 'dues' && type === 'INSERT') {
      const b = await getBuilding(record.building_id);
      await emailToUserIds(await unitOwnerIds(record.unit_id), `Dues for ${record.period_label}: ${money(record.amount_due)}`,
        emailHtml('Dues issued',
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">Your dues for <strong>${esc(record.period_label)}</strong> are ready.</p>
           ${table(row('Amount due', money(record.amount_due)) + (record.due_date ? row('Due date', esc(record.due_date)) : ''))}`,
          'View My Account', `${APP_URL}/finance`),
        b?.name ?? 'BuildingHub');
      const { data: duesUnit } = await supabase.from('units').select('label').eq('id', record.unit_id).single();
      await whatsappToUserIds(await unitOwnerIds(record.unit_id), 'abniyah_dues_issued',
        (name, lang) => {
          const base = [name, record.period_label, money(record.amount_due), duesUnit?.label ?? '—', b?.name ?? '—'];
          return WHATSAPP_PER_LANG ? [...base, payLine(lang, b?.whish_number)] : base;
        });
    }

    // 5e. Dues edited (amount changed) → owner(s)
    if (tbl === 'dues' && type === 'UPDATE' && record.amount_due !== old_record?.amount_due) {
      const b = await getBuilding(record.building_id);
      await emailToUserIds(await unitOwnerIds(record.unit_id), `Dues updated: ${record.period_label}`,
        emailHtml('Dues updated',
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">Your dues for <strong>${esc(record.period_label)}</strong> were updated.</p>
           ${table(row('New amount', money(record.amount_due)) + (record.due_date ? row('Due date', esc(record.due_date)) : ''))}`,
          'View My Account', `${APP_URL}/finance`),
        b?.name ?? 'BuildingHub');
    }

    // 5f. Dues removed → owner(s)
    if (tbl === 'dues' && type === 'DELETE' && old_record) {
      const b = await getBuilding(old_record.building_id);
      await emailToUserIds(await unitOwnerIds(old_record.unit_id), `Dues removed: ${old_record.period_label}`,
        emailHtml('Dues removed',
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">Your dues for <strong>${esc(old_record.period_label)}</strong> were removed.</p>`,
          'View My Account', `${APP_URL}/finance`),
        b?.name ?? 'BuildingHub');
    }

    // 5g. Unit invitation (consent flow, 0053) → the invited person.
    //     Membership is only created when they accept in the app.
    if (tbl === 'membership_invites' && type === 'INSERT' && record.status === 'pending') {
      const { data: unit } = await supabase.from('units').select('label, building_id').eq('id', record.unit_id).single();
      const b = unit ? await getBuilding(unit.building_id) : null;
      const { data: inviter } = record.invited_by
        ? await supabase.from('profiles').select('full_name').eq('id', record.invited_by).single()
        : { data: null };
      await emailToUserIds([record.user_id], `Unit invitation: ${unit?.label ?? ''} at ${b?.name ?? 'a building'}`,
        emailHtml('You have been invited to a unit',
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">${esc(inviter?.full_name ?? 'A building admin')} wants to link your account to a unit. Nothing happens until you accept.</p>
           ${table(row('Unit', esc(unit?.label ?? '—')) + row('Building', esc(b?.name ?? '—')) + row('As', esc(record.tenure)))}
           <p style="color:#64748b;font-size:13px;margin-top:16px;">Sign in and accept or decline the invitation on your dashboard.</p>`,
          'Review Invitation', `${APP_URL}/dashboard`),
        b?.name ?? 'BuildingHub');
      await whatsappToUserIds([record.user_id], 'abniyah_unit_invite',
        (name) => [name, inviter?.full_name ?? 'A building admin', unit?.label ?? '—', b?.name ?? '—']);
    }

    // 6. Scheduled meeting → all building residents (+ .ics)
    if (tbl === 'meetings' && type === 'INSERT' && record.meeting_type === 'scheduled') {
      const b = await getBuilding(record.building_id);
      const ics = b ? generateIcs(record.id, record.title, record.meeting_date, record.meeting_time ?? null, record.summary ?? '', b) : null;
      const meetingHref = safeUrl(record.meeting_url);
      const joinRow = meetingHref ? row('Online', `<a href="${esc(meetingHref)}">Join link</a>`) : '';
      await emailToUserIds(await buildingResidentIds(record.building_id), `📅 Meeting invite: ${record.title}`,
        emailHtml(`You're invited: ${esc(record.title)}`,
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">A meeting has been scheduled at <strong>${esc(b?.name ?? 'your building')}</strong>.</p>
           ${table(row('Date', esc(record.meeting_date)) + (record.meeting_time ? row('Time', esc(record.meeting_time.slice(0, 5))) : '') + joinRow + (record.summary ? row('Notes', esc(record.summary)) : ''))}
           <p style="color:#64748b;font-size:13px;margin-top:16px;">📎 A calendar invite (.ics) is attached.</p>`,
          'View in BuildingHub', `${APP_URL}/meetings`),
        b?.name ?? 'BuildingHub',
        ics ? [{ filename: 'meeting-invite.ics', content: toBase64(ics) }] : undefined);
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error('Notify error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
