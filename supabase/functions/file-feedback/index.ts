import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// In-app feedback → GitHub issue on jihadmeraachli/BuildingHub.
// Secrets: GITHUB_FEEDBACK_TOKEN = fine-grained PAT, repo BuildingHub,
// permission Issues: Read & Write. JWT verification stays ON (the app invokes
// with the signed-in user's token); ownership of the row is checked here.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GITHUB_TOKEN = Deno.env.get('GITHUB_FEEDBACK_TOKEN') ?? '';
const REPO = Deno.env.get('GITHUB_FEEDBACK_REPO') || 'jihadmeraachli/BuildingHub';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const CATEGORY_LABEL: Record<string, string> = { bug: 'bug', idea: 'enhancement', question: 'question' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!GITHUB_TOKEN) return json({ error: 'GITHUB_FEEDBACK_TOKEN not configured' }, 500);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!jwt) return json({ error: 'Unauthorized' }, 401);
    const { data: { user: caller } } = await admin.auth.getUser(jwt);
    if (!caller) return json({ error: 'Unauthorized' }, 401);

    const { id } = await req.json();
    if (!id) return json({ error: 'id required' }, 400);

    const { data: fb } = await admin.from('feedback').select('*').eq('id', id).single();
    if (!fb) return json({ error: 'not found' }, 404);
    if (fb.user_id !== caller.id) return json({ error: 'Forbidden' }, 403);
    if (fb.github_issue) return json({ ok: true, issue: fb.github_issue, existing: true });

    const { data: prof } = await admin.from('profiles').select('full_name').eq('id', caller.id).single();
    const reporter = prof?.full_name || 'Unknown';

    // Screenshot: the attachments bucket is private — embed a 1-year signed URL.
    let shotLine = '';
    if (fb.screenshot_path) {
      const marker = '/object/public/attachments/';
      const path = String(fb.screenshot_path).includes(marker)
        ? String(fb.screenshot_path).split(marker)[1]
        : String(fb.screenshot_path).replace(/^attachments\//, '');
      const { data: signed } = await admin.storage.from('attachments').createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signed?.signedUrl) shotLine = `\n\n**Screenshot:**\n\n![screenshot](${signed.signedUrl})`;
    }

    const title = `[${fb.category}] ${String(fb.message).replace(/\s+/g, ' ').slice(0, 70)}${fb.message.length > 70 ? '…' : ''}`;
    const body = [
      `**Reporter:** ${reporter} (\`${caller.email ?? caller.id}\`)`,
      `**Category:** ${fb.category}`,
      fb.page ? `**Page:** \`${fb.page}\`` : null,
      fb.device ? `**Device:** ${fb.device}` : null,
      '',
      '---',
      '',
      fb.message,
      shotLine || null,
      '',
      '_Filed automatically by the in-app feedback widget._',
    ].filter((l) => l !== null).join('\n');

    const ghHeaders = {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'abniyah-feedback',
    };
    let res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({ title, body, labels: ['feedback', CATEGORY_LABEL[fb.category] ?? 'feedback'] }),
    });
    // Label validation failure → retry without labels rather than losing the report.
    if (res.status === 422) {
      res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
        method: 'POST', headers: ghHeaders, body: JSON.stringify({ title, body }),
      });
    }
    if (!res.ok) {
      const detail = await res.text();
      console.error('GitHub error:', detail);
      return json({ error: 'GitHub issue creation failed', detail }, 502);
    }
    const issue = await res.json();
    await admin.from('feedback').update({ github_issue: issue.number }).eq('id', id);
    return json({ ok: true, issue: issue.number });
  } catch (err) {
    console.error('file-feedback error:', err);
    return json({ error: String(err) }, 500);
  }
});
