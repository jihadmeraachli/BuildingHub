import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL     = Deno.env.get('FROM_EMAIL')!;
const APP_URL        = Deno.env.get('APP_URL') ?? 'https://buildinghub.app';
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET    = Deno.env.get('CRON_SECRET');

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

// ── Email helpers ────────────────────────────────────────────────────────────

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

async function sendEmail(to: string, subject: string, html: string): Promise<string | null> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) return await res.text();
  return null;
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Auth: require CRON_SECRET header when the secret is configured
  const authHeader = req.headers.get('Authorization') ?? '';
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Load all users and profiles once to avoid N+1 calls
    const [{ data: authData }, { data: profiles }] = await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin.from('profiles').select('id, full_name, notify_email, status'),
    ]);

    const emailMap: Record<string, string> = {};
    for (const u of (authData?.users ?? [])) {
      if (u.email) emailMap[u.id] = u.email;
    }

    type Profile = { id: string; full_name: string; notify_email: boolean; status: string };
    const profileMap: Record<string, Profile> = {};
    for (const p of (profiles as Profile[] ?? [])) {
      profileMap[p.id] = p;
    }

    let sent = 0;
    const errors: string[] = [];

    async function deliver(userId: string, subject: string, html: string) {
      const prof = profileMap[userId];
      const email = emailMap[userId];
      if (!email || !prof?.notify_email || prof.status !== 'active') return;
      const err = await sendEmail(email, subject, html);
      if (err) errors.push(`${email}: ${err}`);
      else sent++;
    }

    // ── 1. Overdue balance reminders ─────────────────────────────────────────
    type OverdueUnit = {
      unit_id: string; unit_label: string; building_id: string;
      building_name: string; balance_usd: number; owner_user_ids: string[];
    };
    const { data: overdueUnits, error: ouErr } = await admin.rpc('get_overdue_units');
    if (ouErr) errors.push(`get_overdue_units: ${ouErr.message}`);

    for (const row of (overdueUnits as OverdueUnit[] ?? [])) {
      const balance = Number(row.balance_usd).toFixed(2);
      const subject = `Payment Reminder — ${row.building_name}, Unit ${row.unit_label}`;
      const html = emailHtml(
        'Outstanding Balance',
        `<p style="color:#475569;font-size:14px;line-height:1.6;">
          Your unit <strong>${row.unit_label}</strong> at <strong>${row.building_name}</strong>
          has an outstanding balance of
          <strong style="color:#dc2626;">$${balance}</strong>.
        </p>
        <p style="color:#475569;font-size:14px;line-height:1.6;">
          Please arrange payment at your earliest convenience or contact your building admin for details.
        </p>`,
        'View Statement',
        `${APP_URL}/finance`,
      );
      for (const uid of (row.owner_user_ids ?? [])) {
        await deliver(uid, subject, html);
      }
    }

    // ── 2. Overdue dues reminders ─────────────────────────────────────────────
    // Only sent when dues exist AND are past due_date (dues-mode buildings).
    // Units already caught by get_overdue_units will get a second email here
    // with the specific period — acceptable; in practice most dues-mode units
    // appear in both queries.
    type OverdueDue = {
      unit_id: string; unit_label: string; building_id: string;
      building_name: string; period_label: string; due_date: string;
      amount_due: number; owner_user_ids: string[];
    };
    const { data: overdueDues, error: odErr } = await admin.rpc('get_overdue_dues');
    if (odErr) errors.push(`get_overdue_dues: ${odErr.message}`);

    for (const row of (overdueDues as OverdueDue[] ?? [])) {
      const subject = `Dues Overdue — ${row.period_label} — ${row.building_name}`;
      const html = emailHtml(
        'Dues Payment Overdue',
        `<p style="color:#475569;font-size:14px;line-height:1.6;">
          Your dues of <strong style="color:#dc2626;">$${Number(row.amount_due).toFixed(2)}</strong>
          for period <strong>${row.period_label}</strong> at unit
          <strong>${row.unit_label}</strong>, <strong>${row.building_name}</strong>
          were due on <strong>${row.due_date}</strong> and have not been received.
        </p>
        <p style="color:#475569;font-size:14px;line-height:1.6;">
          Please arrange payment or contact your building admin.
        </p>`,
        'View Dues',
        `${APP_URL}/dues`,
      );
      for (const uid of (row.owner_user_ids ?? [])) {
        await deliver(uid, subject, html);
      }
    }

    // ── 3. Inspection due-date reminders ─────────────────────────────────────
    type DueInspection = {
      inspection_id: string; title: string; category: string;
      next_due_date: string; building_id: string | null;
      compound_id: string | null; location_name: string;
      admin_user_ids: string[];
    };
    const { data: dueInspections, error: diErr } = await admin.rpc('get_due_inspections', { days_ahead: 7 });
    if (diErr) errors.push(`get_due_inspections: ${diErr.message}`);

    for (const row of (dueInspections as DueInspection[] ?? [])) {
      const isOverdue = new Date(row.next_due_date) < new Date();
      const urgency = isOverdue ? 'Overdue' : 'Due Soon';
      const subject = `Inspection ${urgency} — ${row.category.replace('_', ' ')} — ${row.location_name}`;
      const html = emailHtml(
        isOverdue ? `⚠️ Inspection Overdue` : `Inspection Due Soon`,
        `<p style="color:#475569;font-size:14px;line-height:1.6;">
          The <strong>${row.category.replace(/_/g, ' ')}</strong> inspection
          at <strong>${row.location_name}</strong>
          ${isOverdue
            ? `<span style="color:#dc2626;">was due on <strong>${row.next_due_date}</strong> and has not been recorded.</span>`
            : `is due on <strong style="color:#d97706;">${row.next_due_date}</strong>.`}
        </p>
        ${row.title ? `<p style="color:#64748b;font-size:13px;font-style:italic;">${row.title}</p>` : ''}
        <p style="color:#475569;font-size:14px;line-height:1.6;">
          Please schedule and record this inspection in BuildingHub.
        </p>`,
        'View Inspections',
        `${APP_URL}/inspections`,
      );
      for (const uid of (row.admin_user_ids ?? [])) {
        await deliver(uid, subject, html);
      }
    }

    return json({
      success: true,
      sent,
      errors,
      summary: {
        overdue_units: (overdueUnits as unknown[])?.length ?? 0,
        overdue_dues: (overdueDues as unknown[])?.length ?? 0,
        due_inspections: (dueInspections as unknown[])?.length ?? 0,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return json({ error: msg }, 500);
  }
});
