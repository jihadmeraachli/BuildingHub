import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL = Deno.env.get('FROM_EMAIL')!;
const APP_URL = Deno.env.get('APP_URL')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Helpers ────────────────────────────────────────────────────────────────────

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

async function getBuilding(buildingId: string): Promise<{ name: string; address: string; city: string; country: string } | null> {
  const { data } = await supabase.from('buildings').select('name, address, city, country').eq('id', buildingId).single();
  return data ?? null;
}

function emailHtml(title: string, bodyHtml: string, ctaLabel: string, ctaUrl: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
        <tr><td style="background:#1e40af;padding:20px 32px;">
          <p style="margin:0;color:#fff;font-size:18px;font-weight:700;">BuildingHub</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 16px;font-size:18px;color:#0f172a;font-weight:600;">${title}</h2>
          ${bodyHtml}
          <div style="margin-top:28px;">
            <a href="${ctaUrl}" style="display:inline-block;background:#1e40af;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:500;">${ctaLabel}</a>
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

function row(label: string, value: string) {
  return `<tr>
    <td style="padding:6px 0;color:#94a3b8;font-size:14px;width:120px;vertical-align:top;">${label}</td>
    <td style="padding:6px 0;color:#0f172a;font-size:14px;">${value}</td>
  </tr>`;
}

function table(rows: string) {
  return `<table style="width:100%;border-collapse:collapse;">${rows}</table>`;
}

async function getUserEmail(userId: string): Promise<string | null> {
  const { data: { user } } = await supabase.auth.admin.getUserById(userId);
  return user?.email ?? null;
}

async function getAdmins(buildingId: string) {
  const { data } = await supabase.from('profiles').select('*')
    .eq('building_id', buildingId).in('role', ['building_admin', 'super_admin']).eq('status', 'active');
  return data ?? [];
}

async function getResidents(buildingId: string, apartmentNumber?: string | null) {
  let q = supabase.from('profiles').select('*').eq('building_id', buildingId).eq('status', 'active');
  if (apartmentNumber) q = q.eq('apartment_number', apartmentNumber);
  const { data } = await q;
  return data ?? [];
}

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function generateIcs(
  uid: string,
  title: string,
  meeting_date: string,
  meeting_time: string | null,
  summary: string,
  building: { name: string; address: string; city: string; country: string },
): string {
  const dateStr = meeting_date.replace(/-/g, '');
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const location = `${building.address}, ${building.city}, ${building.country}`;

  let dtstart: string;
  let dtend: string;

  if (meeting_time) {
    const t = meeting_time.replace(/:/g, '').slice(0, 6).padEnd(6, '0');
    const endHour = String((parseInt(t.slice(0, 2)) + 1) % 24).padStart(2, '0');
    dtstart = `DTSTART:${dateStr}T${t}`;
    dtend = `DTEND:${dateStr}T${endHour}${t.slice(2)}`;
  } else {
    dtstart = `DTSTART;VALUE=DATE:${dateStr}`;
    dtend = `DTEND;VALUE=DATE:${dateStr}`;
  }

  const desc = summary ? `DESCRIPTION:${summary.replace(/[\r\n]+/g, '\\n')}` : null;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BuildingHub//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}@buildinghub`,
    `DTSTAMP:${now}`,
    dtstart,
    dtend,
    `SUMMARY:${title}`,
    `LOCATION:${location}`,
    desc,
    `ORGANIZER;CN="${building.name}":mailto:${FROM_EMAIL}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean) as string[];

  return lines.join('\r\n');
}

const PRIORITY_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', urgent: '🔴 Urgent' };
const CATEGORY_LABEL: Record<string, string> = {
  water: 'Water', electricity: 'Electricity',
  common_expenses: 'Common Expenses', projects: 'Projects', contracts: 'Contracts',
};

// ── Main handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const { type, table: tbl, record, old_record } = await req.json();

    // 1. New resident registered → notify admins
    if (tbl === 'profiles' && type === 'INSERT' && record.status === 'pending' && record.building_id) {
      const building = await getBuilding(record.building_id);
      const buildingName = building?.name ?? 'BuildingHub';
      const admins = await getAdmins(record.building_id);
      for (const admin of admins.filter((a: any) => a.notify_email)) {
        const email = await getUserEmail(admin.id);
        if (!email) continue;
        await sendEmail(
          email,
          'New resident registration awaiting approval',
          emailHtml(
            'New resident registration',
            `<p style="color:#475569;font-size:14px;line-height:1.6;">
              A new resident has registered and is awaiting your approval.
            </p>
            ${table(
              row('Name', record.full_name) +
              row('Apartment', record.apartment_number ?? '—') +
              row('Phone', record.phone ?? '—')
            )}`,
            'Review Registration',
            `${APP_URL}/users`
          ),
          buildingName
        );
      }
    }

    // 2. Resident approved → notify the resident
    if (tbl === 'profiles' && type === 'UPDATE' && old_record?.status === 'pending' && record.status === 'active') {
      if (record.notify_email) {
        const building = await getBuilding(record.building_id);
        const buildingName = building?.name ?? 'BuildingHub';
        const email = await getUserEmail(record.id);
        if (email) {
          await sendEmail(
            email,
            'Your registration has been approved',
            emailHtml(
              `Welcome, ${record.full_name}!`,
              `<p style="color:#475569;font-size:14px;line-height:1.6;">
                Your registration for <strong>${buildingName}</strong> has been approved. You can now log in and access your building's portal.
              </p>`,
              'Log In to BuildingHub',
              `${APP_URL}/`
            ),
            buildingName
          );
        }
      }
    }

    // 3. New issue logged → notify admins
    if (tbl === 'issues' && type === 'INSERT') {
      const building = await getBuilding(record.building_id);
      const buildingName = building?.name ?? 'BuildingHub';
      const admins = await getAdmins(record.building_id);
      for (const admin of admins.filter((a: any) => a.notify_email)) {
        const email = await getUserEmail(admin.id);
        if (!email) continue;
        await sendEmail(
          email,
          `New issue reported: ${record.title}`,
          emailHtml(
            'New issue reported',
            `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">
              A new issue has been logged in <strong>${buildingName}</strong>.
            </p>
            ${table(
              row('Title', record.title) +
              row('Priority', PRIORITY_LABEL[record.priority] ?? record.priority) +
              row('Location', record.location) +
              row('Description', record.description)
            )}`,
            'View Issue',
            `${APP_URL}/issues`
          ),
          buildingName
        );
      }
    }

    // 4. New billing entry → notify affected residents
    if (tbl === 'billing_entries' && type === 'INSERT') {
      const building = await getBuilding(record.building_id);
      const buildingName = building?.name ?? 'BuildingHub';
      const targets = await getResidents(record.building_id, record.apartment_number);
      for (const resident of targets.filter((r: any) => r.notify_email)) {
        const email = await getUserEmail(resident.id);
        if (!email) continue;
        await sendEmail(
          email,
          `New billing entry: ${record.description}`,
          emailHtml(
            'New billing entry added',
            `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">
              A new billing entry has been added for <strong>${buildingName}</strong>.
            </p>
            ${table(
              row('Description', record.description) +
              row('Category', CATEGORY_LABEL[record.category] ?? record.category) +
              row('Amount', `$${Number(record.amount_usd).toFixed(2)}`) +
              row('Status', record.status === 'unpaid' ? '⚠️ Unpaid' : '✅ Paid')
            )}`,
            'View Billing',
            `${APP_URL}/billing`
          ),
          buildingName
        );
      }
    }

    // 5. New scheduled meeting → email all residents with calendar invite (.ics)
    //    Past meeting records are silent (admin record-keeping only)
    if (tbl === 'meetings' && type === 'INSERT' && record.meeting_type === 'scheduled') {
      const building = await getBuilding(record.building_id);
      const buildingName = building?.name ?? 'BuildingHub';
      const residents = await getResidents(record.building_id);

      const timeLabel = record.meeting_time ? record.meeting_time.slice(0, 5) : null;
      const dateLabel = record.meeting_date;

      const icsContent = building
        ? generateIcs(record.id, record.title, record.meeting_date, record.meeting_time ?? null, record.summary ?? '', building)
        : null;

      for (const resident of residents.filter((r: any) => r.notify_email)) {
        const email = await getUserEmail(resident.id);
        if (!email) continue;
        await sendEmail(
          email,
          `📅 Meeting invite: ${record.title}`,
          emailHtml(
            `You're invited: ${record.title}`,
            `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px;">
              A meeting has been scheduled at <strong>${buildingName}</strong>. Please add it to your calendar.
            </p>
            ${table(
              row('Date', dateLabel) +
              (timeLabel ? row('Time', timeLabel) : '') +
              (record.summary ? row('Notes', record.summary) : '')
            )}
            <p style="color:#64748b;font-size:13px;margin-top:16px;">📎 A calendar invite (.ics) is attached — open it to add this to your calendar.</p>`,
            'View in BuildingHub',
            `${APP_URL}/meetings`
          ),
          buildingName,
          icsContent ? [{ filename: 'meeting-invite.ics', content: toBase64(icsContent) }] : undefined
        );
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    console.error('Notify error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
