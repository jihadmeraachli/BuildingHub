import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL = Deno.env.get('FROM_EMAIL')!;
const APP_URL = Deno.env.get('APP_URL')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// service-role client → bypasses RLS, can read grants/memberships/profiles freely
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
const money = (n: number) => `$${Number(n).toFixed(2)}`;

// ── Recipient resolution (v3 model: memberships, with legacy fallback) ────────
async function getBuilding(buildingId: string) {
  const { data } = await supabase.from('buildings').select('name, address, city, country').eq('id', buildingId).single();
  return data ?? null;
}
async function getUserEmail(userId: string): Promise<string | null> {
  const { data: { user } } = await supabase.auth.admin.getUserById(userId);
  return user?.email ?? null;
}

/** owner/occupant user ids of a unit (new model) */
async function unitOwnerIds(unitId: string): Promise<string[]> {
  const { data } = await supabase.from('memberships').select('user_id').eq('unit_id', unitId);
  return (data ?? []).map((m: { user_id: string }) => m.user_id);
}

/** everyone living in a building: memberships ∪ legacy profiles.building_id */
async function buildingResidentIds(buildingId: string): Promise<string[]> {
  const ids = new Set<string>();
  const { data: us } = await supabase.from('units').select('id').eq('building_id', buildingId);
  const unitIds = (us ?? []).map((u: { id: string }) => u.id);
  if (unitIds.length) {
    const { data: ms } = await supabase.from('memberships').select('user_id').in('unit_id', unitIds);
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
    const { type, table: tbl, record, old_record } = await req.json();

    // 1. New resident registered → admins
    if (tbl === 'profiles' && type === 'INSERT' && record.status === 'pending' && record.building_id) {
      const b = await getBuilding(record.building_id);
      await emailToUserIds(
        await buildingAdminIds(record.building_id),
        'New resident registration awaiting approval',
        emailHtml('New resident registration',
          `<p style="color:#475569;font-size:14px;line-height:1.6;">A new resident has registered and is awaiting your approval.</p>
           ${table(row('Name', record.full_name) + row('Apartment', record.apartment_number ?? '—') + row('Phone', record.phone ?? '—'))}`,
          'Review Registration', `${APP_URL}/users`),
        b?.name ?? 'BuildingHub');
    }

    // 2. Resident approved → the resident
    if (tbl === 'profiles' && type === 'UPDATE' && old_record?.status === 'pending' && record.status === 'active') {
      const b = await getBuilding(record.building_id);
      await emailToUserIds([record.id], 'Your registration has been approved',
        emailHtml(`Welcome, ${record.full_name}!`,
          `<p style="color:#475569;font-size:14px;line-height:1.6;">Your registration for <strong>${b?.name ?? 'your building'}</strong> has been approved. You can now log in.</p>`,
          'Log In to BuildingHub', `${APP_URL}/`),
        b?.name ?? 'BuildingHub');
    }

    // 3. New issue → admins (excluding reporter)
    if (tbl === 'issues' && type === 'INSERT') {
      const b = await getBuilding(record.building_id);
      const admins = (await buildingAdminIds(record.building_id)).filter((id) => id !== record.reported_by);
      await emailToUserIds(admins, `New issue reported: ${record.title}`,
        emailHtml('New issue reported',
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">A new issue has been logged in <strong>${b?.name ?? 'your building'}</strong>.</p>
           ${table(row('Title', record.title) + row('Priority', PRIORITY_LABEL[record.priority] ?? record.priority) + row('Location', record.location ?? '—') + (record.apartment_number ? row('Apartment', record.apartment_number) : '') + row('Description', record.description ?? '—'))}`,
          'View Issue', `${APP_URL}/issues`),
        b?.name ?? 'BuildingHub');
    }

    // 3b. Issue resolved → reporter
    if (tbl === 'issues' && type === 'UPDATE' && old_record?.status !== 'resolved' && record.status === 'resolved') {
      const b = await getBuilding(record.building_id);
      await emailToUserIds([record.reported_by], `Issue resolved: ${record.title}`,
        emailHtml('Your issue has been resolved',
          `<p style="color:#475569;font-size:14px;line-height:1.6;">${record.title}</p>
           ${record.resolution_notes ? table(row('Notes', record.resolution_notes)) : ''}`,
          'View Issue', `${APP_URL}/issues`),
        b?.name ?? 'BuildingHub');
    }

    // 4. New charge (v3 finance) → the unit's owner(s)
    if (tbl === 'charges' && type === 'INSERT') {
      const b = await getBuilding(record.building_id);
      await emailToUserIds(await unitOwnerIds(record.unit_id), `New charge: ${record.description || 'Charge'}`,
        emailHtml('New charge added',
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">A new charge has been added to your unit's account.</p>
           ${table(row('Description', record.description || '—') + row('Category', CATEGORY_LABEL[record.category] ?? record.category) + row('Amount', money(record.amount_usd)))}`,
          'View My Account', `${APP_URL}/finance`),
        b?.name ?? 'BuildingHub');
    }

    // 5. Payment recorded (v3 finance) → the unit's owner(s) (receipt)
    if (tbl === 'payments' && type === 'INSERT') {
      const b = await getBuilding(record.building_id);
      await emailToUserIds(await unitOwnerIds(record.unit_id), 'Payment received — thank you',
        emailHtml('Payment recorded',
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">We've recorded your payment. Thank you.</p>
           ${table(row('Amount', money(record.amount_usd)) + row('Method', METHOD_LABEL[record.method] ?? record.method) + row('Date', record.paid_on))}`,
          'View My Account', `${APP_URL}/finance`),
        b?.name ?? 'BuildingHub');
    }

    // 5b. Payment edited (amount changed) → owner(s)
    if (tbl === 'payments' && type === 'UPDATE' && record.amount_usd !== old_record?.amount_usd) {
      const b = await getBuilding(record.building_id);
      await emailToUserIds(await unitOwnerIds(record.unit_id), 'Your payment was updated',
        emailHtml('Payment updated',
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">A payment on your account was updated.</p>
           ${table(row('New amount', money(record.amount_usd)) + row('Date', record.paid_on))}`,
          'View My Account', `${APP_URL}/finance`),
        b?.name ?? 'BuildingHub');
    }

    // 5c. Payment removed → owner(s)  (DELETE payloads carry old_record)
    if (tbl === 'payments' && type === 'DELETE' && old_record) {
      const b = await getBuilding(old_record.building_id);
      await emailToUserIds(await unitOwnerIds(old_record.unit_id), 'A payment was removed',
        emailHtml('Payment removed',
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">A payment of <strong>${money(old_record.amount_usd)}</strong> was removed from your account.</p>`,
          'View My Account', `${APP_URL}/finance`),
        b?.name ?? 'BuildingHub');
    }

    // 6. Scheduled meeting → all building residents (+ .ics)
    if (tbl === 'meetings' && type === 'INSERT' && record.meeting_type === 'scheduled') {
      const b = await getBuilding(record.building_id);
      const ics = b ? generateIcs(record.id, record.title, record.meeting_date, record.meeting_time ?? null, record.summary ?? '', b) : null;
      const joinRow = record.meeting_url ? row('Online', `<a href="${record.meeting_url}">Join link</a>`) : '';
      await emailToUserIds(await buildingResidentIds(record.building_id), `📅 Meeting invite: ${record.title}`,
        emailHtml(`You're invited: ${record.title}`,
          `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">A meeting has been scheduled at <strong>${b?.name ?? 'your building'}</strong>.</p>
           ${table(row('Date', record.meeting_date) + (record.meeting_time ? row('Time', record.meeting_time.slice(0, 5)) : '') + joinRow + (record.summary ? row('Notes', record.summary) : ''))}
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
