import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL     = Deno.env.get('FROM_EMAIL')!;
const APP_URL        = Deno.env.get('APP_URL') ?? 'https://app.abniyah.com';
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET    = Deno.env.get('CRON_SECRET');

// WhatsApp (Meta Cloud API) — dormant unless both secrets are set, same as
// dynamic-action. Template must exist & be approved: abniyah_payment_reminder.
const WHATSAPP_TOKEN    = Deno.env.get('WHATSAPP_TOKEN') ?? '';
const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_ID') ?? '';
const WHATSAPP_LANG     = Deno.env.get('WHATSAPP_LANG') || 'en';
const whatsappEnabled = () => Boolean(WHATSAPP_TOKEN && WHATSAPP_PHONE_ID);

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

const beirutNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Beirut' }));
const beirutPeriod = () => {
  const d = beirutNow();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
/** Beirut calendar day — the reminders_sent dedup key since 0076. */
const beirutToday = () => {
  const d = beirutNow();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ── Language ─────────────────────────────────────────────────────────────────
// A payment reminder is the most consequential email this app sends, and it
// used to arrive in English regardless of who was reading it. Each recipient's
// profiles.preferred_language (0101 added 'fr') now picks the wording.
//
// English is the source of truth: `Dict` is inferred from EN, so the compiler
// rejects an AR or FR pack that is missing a key. Terminology matches
// src/i18n/{ar,fr}.json so the email and the screen use the same words.
//
// The pack is duplicated from dynamic-action rather than shared: both
// functions deploy as a single pasted index.ts through the Supabase dashboard
// editor, and a ../_shared/ import would not survive that.
type Lang = 'en' | 'ar' | 'fr';
const langOf = (v: unknown): Lang => (v === 'ar' || v === 'fr' ? v : 'en');

const EN = {
  dir: 'ltr' as 'ltr' | 'rtl',
  // Latin digits everywhere: Lebanon writes dates and money in Western
  // numerals even in Arabic, so 'ar' alone (Arabic-Indic) would look wrong.
  locale: 'en-US',
  footer: 'You received this because you have notifications enabled in Abniyah.',
  ctaAccount: 'View My Account',
  ctaInspections: 'View Inspections',
  pay: {
    subjOverdue: (b: string, u: string) => `Payment overdue: ${b}, unit ${u}`,
    subjDue: (b: string, u: string) => `Payment reminder: ${b}, unit ${u}`,
    titleOverdue: 'Payment overdue',
    titleDue: 'Outstanding balance',
    body: (unit: string, building: string, amount: string, asOf: string) =>
      `A friendly reminder: unit <strong>${unit}</strong> at <strong>${building}</strong> has an outstanding balance of <strong style="color:#dc2626;">${amount}</strong>${asOf}.`,
    asOf: (d: string) => ` as of <strong>${d}</strong>`,
    pastDue: (d: string) => `This payment is now <strong>past due</strong>${d ? ` (was due ${d})` : ''}.`,
    settleBy: (d: string) => `Please settle it by <strong>${d}</strong>.`,
    whish: (n: string) => `You can pay directly through <strong>Whish</strong> to <strong>${n}</strong>.`,
    tail: 'Details and payment options are in your account.',
  },
  access: {
    subjHolder: (scope: string) => `Your access to ${scope} ends soon`,
    subjAdmin: (name: string, scope: string) => `${name}'s access to ${scope} ends soon`,
    title: 'Management access ending',
    holder: (role: string, scope: string, d: string) =>
      `Your <strong>${role}</strong> access to <strong>${scope}</strong> ends on <strong>${d}</strong>. After that day you will no longer see its finances or manage it. If it should continue, ask an administrator to extend it.`,
    admin: (name: string, role: string, scope: string, d: string) =>
      `<strong>${name}</strong>'s <strong>${role}</strong> access to <strong>${scope}</strong> ends on <strong>${d}</strong>. Extend it from Security if it should continue; otherwise nothing to do, it ends on its own.`,
    cta: 'Open Security',
    inapp: (name: string, role: string, d: string) => `${name}: ${role} access ends ${d}`,
    inappHolder: (role: string, d: string) => `Your ${role} access ends ${d}`,
  },
  inspection: {
    subj: (overdue: boolean, cat: string, loc: string) =>
      overdue ? `Inspection overdue: ${cat}, ${loc}` : `Inspection due soon: ${cat}, ${loc}`,
    titleOverdue: '⚠️ Inspection overdue',
    titleDue: 'Inspection due soon',
    lead: (cat: string, loc: string) =>
      `The <strong>${cat}</strong> inspection at <strong>${loc}</strong>`,
    wasDue: (d: string) => `<span style="color:#dc2626;">was due on <strong>${d}</strong> and has not been recorded.</span>`,
    isDue: (d: string) => `is due on <strong style="color:#d97706;">${d}</strong>.`,
    category: {
      generator: 'Generator', elevator: 'Elevator', fire_safety: 'Fire safety',
      water_tank: 'Water tank', electrical: 'Electrical', hvac: 'HVAC', other: 'Other',
    } as Record<string, string>,
  },
};
type Dict = typeof EN;

const AR: Dict = {
  dir: 'rtl',
  locale: 'ar-u-nu-latn',
  footer: 'وصلتك هذه الرسالة لأن الإشعارات مفعّلة في حسابك على أبنية.',
  ctaAccount: 'عرض حسابي',
  ctaInspections: 'عرض الفحوصات',
  pay: {
    subjOverdue: (b: string, u: string) => `دفعة متأخرة: ${b}، شقة ${u}`,
    subjDue: (b: string, u: string) => `تذكير بالدفع: ${b}، شقة ${u}`,
    titleOverdue: 'دفعة متأخرة',
    titleDue: 'رصيد مستحق',
    body: (unit: string, building: string, amount: string, asOf: string) =>
      `تذكير ودّي: على الشقة <strong>${unit}</strong> في <strong>${building}</strong> رصيد مستحق قدره <strong style="color:#dc2626;">${amount}</strong>${asOf}.`,
    asOf: (d: string) => ` كما في <strong>${d}</strong>`,
    pastDue: (d: string) => `هذه الدفعة <strong>متأخرة</strong> الآن${d ? ` (كان موعدها ${d})` : ''}.`,
    settleBy: (d: string) => `يرجى تسديدها قبل <strong>${d}</strong>.`,
    whish: (n: string) => `يمكنك الدفع مباشرة عبر <strong>Whish</strong> إلى <strong>${n}</strong>.`,
    tail: 'التفاصيل وخيارات الدفع متوفرة في حسابك.',
  },
  access: {
    subjHolder: (scope: string) => `صلاحيتك على ${scope} تنتهي قريباً`,
    subjAdmin: (name: string, scope: string) => `صلاحية ${name} على ${scope} تنتهي قريباً`,
    title: 'صلاحية إدارية تنتهي',
    holder: (role: string, scope: string, d: string) =>
      `صلاحيتك كـ<strong>${role}</strong> على <strong>${scope}</strong> تنتهي في <strong>${d}</strong>. بعد ذلك اليوم لن ترى ماليّتها ولن تتمكن من إدارتها. إن كان يجب أن تستمر، اطلب من مسؤول تمديدها.`,
    admin: (name: string, role: string, scope: string, d: string) =>
      `صلاحية <strong>${name}</strong> كـ<strong>${role}</strong> على <strong>${scope}</strong> تنتهي في <strong>${d}</strong>. مدّدها من صفحة الأمان إن كان يجب أن تستمر؛ وإلا فلا شيء عليك فعله، ستنتهي وحدها.`,
    cta: 'فتح الأمان',
    inapp: (name: string, role: string, d: string) => `${name}: صلاحية ${role} تنتهي ${d}`,
    inappHolder: (role: string, d: string) => `صلاحيتك كـ${role} تنتهي ${d}`,
  },
  inspection: {
    subj: (overdue: boolean, cat: string, loc: string) =>
      overdue ? `فحص متأخر: ${cat}، ${loc}` : `فحص مستحق قريباً: ${cat}، ${loc}`,
    titleOverdue: '⚠️ فحص متأخر',
    titleDue: 'فحص مستحق قريباً',
    lead: (cat: string, loc: string) =>
      `فحص <strong>${cat}</strong> في <strong>${loc}</strong>`,
    wasDue: (d: string) => `<span style="color:#dc2626;">كان مستحقاً في <strong>${d}</strong> ولم يُسجَّل بعد.</span>`,
    isDue: (d: string) => `مستحق في <strong style="color:#d97706;">${d}</strong>.`,
    category: {
      generator: 'المولّد', elevator: 'المصعد', fire_safety: 'السلامة من الحريق',
      water_tank: 'خزان المياه', electrical: 'الكهرباء', hvac: 'التكييف', other: 'أخرى',
    },
  },
};

// French typography: a U+00A0 no-break space before : ; ! ? — matching fr.json.
const FR: Dict = {
  dir: 'ltr',
  locale: 'fr-FR',
  footer: 'Vous recevez ce message parce que les notifications sont activées dans votre compte Abniyah.',
  ctaAccount: 'Voir mon compte',
  ctaInspections: 'Voir les contrôles',
  pay: {
    subjOverdue: (b: string, u: string) => `Paiement en retard : ${b}, lot ${u}`,
    subjDue: (b: string, u: string) => `Rappel de paiement : ${b}, lot ${u}`,
    titleOverdue: 'Paiement en retard',
    titleDue: 'Solde à régler',
    body: (unit: string, building: string, amount: string, asOf: string) =>
      `Petit rappel : le lot <strong>${unit}</strong> à <strong>${building}</strong> présente un solde à régler de <strong style="color:#dc2626;">${amount}</strong>${asOf}.`,
    asOf: (d: string) => ` au <strong>${d}</strong>`,
    pastDue: (d: string) => `Ce paiement est désormais <strong>en retard</strong>${d ? ` (échéance du ${d})` : ''}.`,
    settleBy: (d: string) => `Merci de le régler avant le <strong>${d}</strong>.`,
    whish: (n: string) => `Vous pouvez régler directement via <strong>Whish</strong> au <strong>${n}</strong>.`,
    tail: 'Le détail et les moyens de paiement sont disponibles dans votre compte.',
  },
  access: {
    subjHolder: (scope: string) => `Votre accès à ${scope} prend fin bientôt`,
    subjAdmin: (name: string, scope: string) => `L’accès de ${name} à ${scope} prend fin bientôt`,
    title: 'Accès de gestion qui prend fin',
    holder: (role: string, scope: string, d: string) =>
      `Votre accès <strong>${role}</strong> à <strong>${scope}</strong> prend fin le <strong>${d}</strong>. Passé ce jour, vous ne verrez plus ses finances et ne pourrez plus le gérer. S’il doit continuer, demandez à un administrateur de le prolonger.`,
    admin: (name: string, role: string, scope: string, d: string) =>
      `L’accès <strong>${role}</strong> de <strong>${name}</strong> à <strong>${scope}</strong> prend fin le <strong>${d}</strong>. Prolongez-le depuis Sécurité s’il doit continuer ; sinon rien à faire, il prend fin tout seul.`,
    cta: 'Ouvrir Sécurité',
    inapp: (name: string, role: string, d: string) => `${name} : accès ${role} prend fin le ${d}`,
    inappHolder: (role: string, d: string) => `Votre accès ${role} prend fin le ${d}`,
  },
  inspection: {
    subj: (overdue: boolean, cat: string, loc: string) =>
      overdue ? `Contrôle en retard : ${cat}, ${loc}` : `Contrôle à échéance proche : ${cat}, ${loc}`,
    titleOverdue: '⚠️ Contrôle en retard',
    titleDue: 'Contrôle à échéance proche',
    lead: (cat: string, loc: string) =>
      `Le contrôle <strong>${cat}</strong> à <strong>${loc}</strong>`,
    wasDue: (d: string) => `<span style="color:#dc2626;">était dû le <strong>${d}</strong> et n'a pas été enregistré.</span>`,
    isDue: (d: string) => `est dû le <strong style="color:#d97706;">${d}</strong>.`,
    category: {
      generator: 'Générateur', elevator: 'Ascenseur', fire_safety: 'Sécurité incendie',
      water_tank: "Réservoir d'eau", electrical: 'Électricité', hvac: 'Chauffage et climatisation', other: 'Autre',
    },
  },
};

const DICT: Record<Lang, Dict> = { en: EN, ar: AR, fr: FR };

// ── Email ────────────────────────────────────────────────────────────────────
function emailHtml(L: Dict, title: string, bodyHtml: string, ctaLabel: string, ctaUrl: string) {
  // Arabic needs the direction on the document AND inline on the body: Gmail
  // strips <html> attributes, Outlook honours them. Tahoma is the one Arabic
  // face Outlook ships.
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

async function sendEmail(to: string, subject: string, html: string): Promise<string | null> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `"Abniyah" <${FROM_EMAIL}>`, to, subject, html }),
  });
  if (!res.ok) return await res.text();
  return null;
}

// ── WhatsApp (same conventions as dynamic-action) ────────────────────────────
function waPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('961')) return d.length >= 10 ? d : null;
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 7 || d.length === 8) return '961' + d;
  return d.length >= 10 ? d : null;
}
const waParam = (v: unknown) => (String(v ?? '').replace(/\s+/g, ' ').trim() || '—');

// Per-language templates (0060) — flip WHATSAPP_PER_LANG to '1' only after the
// per-language template variants are approved in Meta (docs/WHATSAPP_SETUP.md).
const WHATSAPP_PER_LANG = Deno.env.get('WHATSAPP_PER_LANG') === '1';
type WaLang = 'en' | 'ar';

/** Localized "how to pay" line ({{5}} in the per-language reminder body). */
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

async function sendWhatsApp(toPhone: string, templateName: string, params: string[], lang: WaLang = 'en'): Promise<string | null> {
  // Legacy: bilingual templates (Arabic {{1..n}} then English {{n+1..2n}} — send
  // twice). Per-language mode: single param set + per-recipient language code.
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
        components: [{ type: 'body', parameters: finalParams.map((p) => ({ type: 'text', text: waParam(p) })) }],
      },
    }),
  });
  if (!res.ok) return await res.text();
  return null;
}

// ── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const [{ data: authData }, { data: profiles }, { data: whishRows }] = await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin.from('profiles').select('id, full_name, notify_email, notify_whatsapp, phone, status, preferred_language'),
      admin.from('buildings').select('id, whish_number').not('whish_number', 'is', null),
    ]);

    // building_id → Whish account (0059) for the "pay directly through Whish" line
    const whishMap: Record<string, string> = {};
    for (const w of ((whishRows ?? []) as { id: string; whish_number: string }[])) whishMap[w.id] = w.whish_number;

    const emailMap: Record<string, string> = {};
    for (const u of (authData?.users ?? [])) {
      if (u.email) emailMap[u.id] = u.email;
    }

    type Profile = {
      id: string; full_name: string; notify_email: boolean;
      notify_whatsapp: boolean; phone: string | null; status: string;
      preferred_language: string | null;
    };
    const profileMap: Record<string, Profile> = {};
    for (const p of (profiles as Profile[] ?? [])) profileMap[p.id] = p;

    let sentEmail = 0, sentWhatsApp = 0, sentInApp = 0, skippedDup = 0;
    const errors: string[] = [];

    /** The caller passes a BUILDER, not finished text: this loop walks one
     *  recipient at a time, and each of them may read a different language. */
    async function deliverEmail(userId: string, build: (L: Dict) => { subject: string; html: string }) {
      const prof = profileMap[userId];
      const email = emailMap[userId];
      if (!email || !prof?.notify_email || prof.status !== 'active') return;
      const { subject, html } = build(DICT[langOf(prof.preferred_language)]);
      const err = await sendEmail(email, subject, html);
      if (err) errors.push(`email ${email}: ${err}`);
      else sentEmail++;
    }

    async function deliverWhatsApp(userId: string, template: string, params: (name: string, lang: WaLang) => string[]) {
      if (!whatsappEnabled()) return;
      const prof = profileMap[userId];
      if (!prof?.notify_whatsapp || prof.status !== 'active') return;
      const phone = waPhone(prof.phone);
      if (!phone) return;
      const lang: WaLang = prof.preferred_language === 'ar' ? 'ar' : 'en';
      const err = await sendWhatsApp(phone, template, params(prof.full_name || 'there', lang), lang);
      if (err) errors.push(`whatsapp ${phone}: ${err}`);
      else sentWhatsApp++;
    }

    async function deliverInApp(userId: string, buildingId: string, title: string, body: string) {
      const { error } = await admin.from('notifications').insert({
        user_id: userId, building_id: buildingId, type: 'payment_reminder', title, body,
      });
      if (error) errors.push(`notification: ${error.message}`);
      else sentInApp++;
    }

    /** One reminder across all channels — the reminders_sent insert is FIRST and
     *  unique per (unit, month, PARTY), so a double-run can never double-send.
     *  The party is part of the key since 0070: a leased unit can owe on both
     *  sub-ledgers in the same month, and before the widening the tenant's
     *  reminder was silently swallowed as a duplicate of the owner's. */
    async function remindUnit(
      unitId: string, buildingId: string, unitLabel: string, buildingName: string,
      owed: number, ownerIds: string[], party: 'owner' | 'tenant' = 'owner',
      ctx: { forPeriodEnd?: string | null; dueDate?: string | null; isOverdue?: boolean; source?: 'arrears' | 'dues' } = {},
    ) {
      // sent_on is the dedup key since 0076 — reminders now repeat DAILY across
      // a payment window, so a per-month key would swallow every send after the
      // first. It is passed explicitly rather than left to the column default.
      const { error } = await admin.from('reminders_sent').insert({
        unit_id: unitId, building_id: buildingId, period: beirutPeriod(),
        sent_on: beirutToday(), amount_usd: owed, party,
        // part of the dedup key since 0080: a one-off request and unpaid dues
        // can both fall due on the same day and must not silence each other
        source: ctx.source ?? 'arrears',
      });
      if (error) {
        if (error.code === '23505') { skippedDup++; return; }
        errors.push(`reminders_sent: ${error.message}`);
        return;
      }
      const amount = `$${owed.toFixed(2)}`;
      // The date format follows the reader too: a French reminder saying
      // "31 mars 2026" and an English one saying "March 31, 2026" are the same
      // day written the way each person expects to see it.
      const dayFmt = (L: Dict, d?: string | null) =>
        d ? new Date(d).toLocaleDateString(L.locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '';

      const build = (L: Dict) => {
        // Name the period being settled — the amount is quoted AS OF its close,
        // so saying which period it is keeps the number and the wording honest.
        const forPeriod = ctx.forPeriodEnd ? L.pay.asOf(dayFmt(L, ctx.forPeriodEnd)) : '';
        const byWhen = ctx.isOverdue
          ? `<p style="color:#b91c1c;font-size:14px;line-height:1.6;">${L.pay.pastDue(dayFmt(L, ctx.dueDate))}</p>`
          : ctx.dueDate
            ? `<p style="color:#475569;font-size:14px;line-height:1.6;">${L.pay.settleBy(dayFmt(L, ctx.dueDate))}</p>`
            : '';
        return {
          subject: ctx.isOverdue
            ? L.pay.subjOverdue(buildingName, unitLabel)
            : L.pay.subjDue(buildingName, unitLabel),
          html: emailHtml(L,
            ctx.isOverdue ? L.pay.titleOverdue : L.pay.titleDue,
            `<p style="color:#475569;font-size:14px;line-height:1.6;">
              ${L.pay.body(unitLabel, buildingName, amount, forPeriod)}
            </p>
            ${byWhen}
            ${whishMap[buildingId]
              ? `<p style="color:#475569;font-size:14px;line-height:1.6;">
                  ${L.pay.whish(whishMap[buildingId])}
                </p>`
              : ''}
            <p style="color:#475569;font-size:14px;line-height:1.6;">
              ${L.pay.tail}
            </p>`,
            L.ctaAccount, `${APP_URL}/finance`),
        };
      };
      const whishNote = whishMap[buildingId] ? ` Pay via Whish: ${whishMap[buildingId]}.` : '';
      for (const uid of ownerIds) {
        await deliverEmail(uid, build);
        // ⚠️ param count frozen at 4 (+ payLine) — wording changed, structure did not
        await deliverWhatsApp(uid, 'abniyah_payment_reminder',
          (name, lang) => {
            const base = [name, amount, unitLabel, buildingName];
            return WHATSAPP_PER_LANG ? [...base, payLine(lang, whishMap[buildingId])] : base;
          });
        await deliverInApp(uid, buildingId,
          ctx.isOverdue ? 'Payment overdue' : 'Payment reminder',
          `Unit ${unitLabel}, ${buildingName}: outstanding balance of ${amount}.${whishNote} Details in Finance.`);
      }
    }

    // ── 1. Arrears buildings: negative canonical balance ─────────────────────
    type OverdueUnit = {
      unit_id: string; unit_label: string; building_id: string;
      building_name: string; balance_usd: number; owner_user_ids: string[];
      // 0076: which period is being settled, and where we are in its window
      period_end?: string | null; due_date?: string | null; is_overdue?: boolean;
    };
    const { data: overdueUnits, error: ouErr } = await admin.rpc('get_overdue_units');
    if (ouErr) errors.push(`get_overdue_units: ${ouErr.message}`);
    for (const row of (overdueUnits as OverdueUnit[] ?? [])) {
      await remindUnit(row.unit_id, row.building_id, row.unit_label, row.building_name,
        Number(row.balance_usd), row.owner_user_ids ?? [], 'owner',
        { dueDate: row.due_date, isOverdue: row.is_overdue, source: 'arrears' });
    }

    // ── 2. Dues buildings: latest overdue dues per PARTY, minus that party's
    //      payments since (0070). One row per (unit, party): a leased unit can
    //      owe on both sub-ledgers, and each side is reminded separately.
    type OverdueDue = {
      unit_id: string; unit_label: string; building_id: string;
      building_name: string; period_label: string; due_date: string;
      amount_due: number; owner_user_ids: string[];
      party?: 'owner' | 'tenant'; tenant_id?: string | null; tenant_name?: string | null;
      is_overdue?: boolean;
    };
    const { data: overdueDues, error: odErr } = await admin.rpc('get_overdue_dues');
    if (odErr) errors.push(`get_overdue_dues: ${odErr.message}`);
    for (const row of (overdueDues as OverdueDue[] ?? [])) {
      // dues carry their own due_date; the period being settled IS that dues row
      await remindUnit(row.unit_id, row.building_id, row.unit_label, row.building_name,
        Number(row.amount_due), row.owner_user_ids ?? [], row.party ?? 'owner',
        { dueDate: row.due_date, isOverdue: row.is_overdue, source: 'dues' });
    }

    // ── 3. Inspection reminders → admins (email only, Mondays to avoid spam) ─
    let dueInspections: unknown[] = [];
    if (beirutNow().getDay() === 1) {
      type DueInspection = {
        inspection_id: string; title: string; category: string;
        next_due_date: string; building_id: string | null;
        compound_id: string | null; location_name: string;
        admin_user_ids: string[];
      };
      const { data, error: diErr } = await admin.rpc('get_due_inspections', { days_ahead: 7 });
      if (diErr) errors.push(`get_due_inspections: ${diErr.message}`);
      dueInspections = (data as unknown[]) ?? [];
      for (const row of (data as DueInspection[] ?? [])) {
        const isOverdue = new Date(row.next_due_date) < new Date();
        const build = (L: Dict) => {
          // The category was printed as a de-underscored enum ("fire_safety" →
          // "fire safety"), which is neither translated nor how the app names
          // it. Fall back to that only for a value the catalog does not know.
          const cat = L.inspection.category[row.category] ?? row.category.replace(/_/g, ' ');
          return {
            subject: L.inspection.subj(isOverdue, cat, row.location_name),
            html: emailHtml(L,
              isOverdue ? L.inspection.titleOverdue : L.inspection.titleDue,
              `<p style="color:#475569;font-size:14px;line-height:1.6;">
                ${L.inspection.lead(cat, row.location_name)}
                ${isOverdue
                  ? L.inspection.wasDue(row.next_due_date)
                  : L.inspection.isDue(row.next_due_date)}
              </p>
              ${row.title ? `<p style="color:#64748b;font-size:13px;font-style:italic;">${row.title}</p>` : ''}`,
              L.ctaInspections, `${APP_URL}/inspections`),
          };
        };
        for (const uid of (row.admin_user_ids ?? [])) {
          await deliverEmail(uid, build);
        }
      }
    }

    // ── 4. Management access (0108): sweep what has lapsed, warn what is about to ─
    // The sweep moves expired grants to grant_history; user_can() already
    // ignores them, so this is bookkeeping, not enforcement. The reminder goes
    // once per grant (expiry_notified_on), to the holder and to the scope's
    // admins, 7 days out.
    let expiredGrants = 0, expiringGrants = 0;
    {
      const { data: swept, error: swErr } = await admin.rpc('sweep_expired_grants');
      if (swErr) errors.push(`sweep_expired_grants: ${swErr.message}`);
      else expiredGrants = Number(swept ?? 0);

      type Expiring = { grant_id: string; user_id: string; role: string; expires_at: string; scope_name: string; building_id: string | null; admin_user_ids: string[] };
      const { data: exp, error: exErr } = await admin.rpc('expiring_grants', { p_days: 7 });
      if (exErr) errors.push(`expiring_grants: ${exErr.message}`);
      for (const g of (exp as Expiring[] ?? [])) {
        expiringGrants++;
        const holderName = profileMap[g.user_id]?.full_name || 'A user';
        const roleWord = g.role.replace(/_/g, ' ');
        const dayFmt = (L: Dict) => new Date(g.expires_at).toLocaleDateString(L.locale, { day: 'numeric', month: 'long', year: 'numeric' });
        await deliverEmail(g.user_id, (L) => ({
          subject: L.access.subjHolder(g.scope_name),
          html: emailHtml(L, L.access.title,
            `<p style="color:#475569;font-size:14px;line-height:1.6;">${L.access.holder(roleWord, g.scope_name, dayFmt(L))}</p>`,
            L.ctaAccount, `${APP_URL}/dashboard`),
        }));
        if (g.building_id) await deliverInApp(g.user_id, g.building_id, DICT[langOf(profileMap[g.user_id]?.preferred_language)].access.title,
          DICT[langOf(profileMap[g.user_id]?.preferred_language)].access.inappHolder(roleWord, g.expires_at));
        for (const uid of (g.admin_user_ids ?? [])) {
          await deliverEmail(uid, (L) => ({
            subject: L.access.subjAdmin(holderName, g.scope_name),
            html: emailHtml(L, L.access.title,
              `<p style="color:#475569;font-size:14px;line-height:1.6;">${L.access.admin(holderName, roleWord, g.scope_name, dayFmt(L))}</p>`,
              L.access.cta, `${APP_URL}/security`),
          }));
          if (g.building_id) await deliverInApp(uid, g.building_id, DICT[langOf(profileMap[uid]?.preferred_language)].access.title,
            DICT[langOf(profileMap[uid]?.preferred_language)].access.inapp(holderName, roleWord, g.expires_at));
        }
        const { error: mkErr } = await admin.from('grants').update({ expiry_notified_on: beirutToday() }).eq('id', g.grant_id);
        if (mkErr) errors.push(`expiry_notified_on: ${mkErr.message}`);
      }
    }

    return json({
      success: true,
      sent: { email: sentEmail, whatsapp: sentWhatsApp, in_app: sentInApp },
      skipped_duplicates: skippedDup,
      errors,
      summary: {
        overdue_units: (overdueUnits as unknown[])?.length ?? 0,
        overdue_dues: (overdueDues as unknown[])?.length ?? 0,
        due_inspections: dueInspections.length,
        expired_grants: expiredGrants,
        expiring_grants: expiringGrants,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return json({ error: msg }, 500);
  }
});
