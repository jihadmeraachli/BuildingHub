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

// ── Email ────────────────────────────────────────────────────────────────────
function emailHtml(title: string, bodyHtml: string, ctaLabel: string, ctaUrl: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
  <body style="margin:0;padding:0;background:#f5f6f8;font-family:'Segoe UI',Arial,sans-serif;">
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
          <p style="margin:0;font-size:12px;color:#94a3b8;">You received this because you have notifications enabled in Abniyah.</p>
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

    async function deliverEmail(userId: string, subject: string, html: string) {
      const prof = profileMap[userId];
      const email = emailMap[userId];
      if (!email || !prof?.notify_email || prof.status !== 'active') return;
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
    ) {
      const { error } = await admin.from('reminders_sent').insert({
        unit_id: unitId, building_id: buildingId, period: beirutPeriod(), amount_usd: owed, party,
      });
      if (error) {
        if (error.code === '23505') { skippedDup++; return; }
        errors.push(`reminders_sent: ${error.message}`);
        return;
      }
      const amount = `$${owed.toFixed(2)}`;
      const subject = `Payment reminder: ${buildingName}, unit ${unitLabel}`;
      const html = emailHtml(
        'Outstanding balance',
        `<p style="color:#475569;font-size:14px;line-height:1.6;">
          A friendly reminder: unit <strong>${unitLabel}</strong> at <strong>${buildingName}</strong>
          has an outstanding balance of <strong style="color:#dc2626;">${amount}</strong>.
        </p>
        ${whishMap[buildingId]
          ? `<p style="color:#475569;font-size:14px;line-height:1.6;">
              You can pay directly through <strong>Whish</strong> to <strong>${whishMap[buildingId]}</strong>.
            </p>`
          : ''}
        <p style="color:#475569;font-size:14px;line-height:1.6;">
          Details and payment options are in your account.
        </p>`,
        'View My Account', `${APP_URL}/finance`,
      );
      const whishNote = whishMap[buildingId] ? ` Pay via Whish: ${whishMap[buildingId]}.` : '';
      for (const uid of ownerIds) {
        await deliverEmail(uid, subject, html);
        await deliverWhatsApp(uid, 'abniyah_payment_reminder',
          (name, lang) => {
            const base = [name, amount, unitLabel, buildingName];
            return WHATSAPP_PER_LANG ? [...base, payLine(lang, whishMap[buildingId])] : base;
          });
        await deliverInApp(uid, buildingId, 'Payment reminder',
          `Unit ${unitLabel}, ${buildingName}: outstanding balance of ${amount}.${whishNote} Details in Finance.`);
      }
    }

    // ── 1. Arrears buildings: negative canonical balance ─────────────────────
    type OverdueUnit = {
      unit_id: string; unit_label: string; building_id: string;
      building_name: string; balance_usd: number; owner_user_ids: string[];
    };
    const { data: overdueUnits, error: ouErr } = await admin.rpc('get_overdue_units');
    if (ouErr) errors.push(`get_overdue_units: ${ouErr.message}`);
    for (const row of (overdueUnits as OverdueUnit[] ?? [])) {
      await remindUnit(row.unit_id, row.building_id, row.unit_label, row.building_name,
        Number(row.balance_usd), row.owner_user_ids ?? []);
    }

    // ── 2. Dues buildings: latest overdue dues per PARTY, minus that party's
    //      payments since (0070). One row per (unit, party): a leased unit can
    //      owe on both sub-ledgers, and each side is reminded separately.
    type OverdueDue = {
      unit_id: string; unit_label: string; building_id: string;
      building_name: string; period_label: string; due_date: string;
      amount_due: number; owner_user_ids: string[];
      party?: 'owner' | 'tenant'; tenant_id?: string | null; tenant_name?: string | null;
    };
    const { data: overdueDues, error: odErr } = await admin.rpc('get_overdue_dues');
    if (odErr) errors.push(`get_overdue_dues: ${odErr.message}`);
    for (const row of (overdueDues as OverdueDue[] ?? [])) {
      await remindUnit(row.unit_id, row.building_id, row.unit_label, row.building_name,
        Number(row.amount_due), row.owner_user_ids ?? [], row.party ?? 'owner');
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
        const subject = `Inspection ${isOverdue ? 'overdue' : 'due soon'}: ${row.category.replace(/_/g, ' ')}, ${row.location_name}`;
        const html = emailHtml(
          isOverdue ? '⚠️ Inspection overdue' : 'Inspection due soon',
          `<p style="color:#475569;font-size:14px;line-height:1.6;">
            The <strong>${row.category.replace(/_/g, ' ')}</strong> inspection
            at <strong>${row.location_name}</strong>
            ${isOverdue
              ? `<span style="color:#dc2626;">was due on <strong>${row.next_due_date}</strong> and has not been recorded.</span>`
              : `is due on <strong style="color:#d97706;">${row.next_due_date}</strong>.`}
          </p>
          ${row.title ? `<p style="color:#64748b;font-size:13px;font-style:italic;">${row.title}</p>` : ''}`,
          'View Inspections', `${APP_URL}/inspections`,
        );
        for (const uid of (row.admin_user_ids ?? [])) {
          await deliverEmail(uid, subject, html);
        }
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
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return json({ error: msg }, 500);
  }
});
