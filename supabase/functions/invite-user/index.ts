import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5173';

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify the caller is a platform admin
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!jwt) return json({ error: 'Unauthorized' }, 401);

    const { data: { user: caller } } = await admin.auth.getUser(jwt);
    if (!caller) return json({ error: 'Unauthorized' }, 401);

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', caller.id)
      .single();

    const { data: callerGrants } = await admin
      .from('grants')
      .select('scope_type, role, org_id, building_id')
      .eq('user_id', caller.id);

    const callerOrgIds = (callerGrants ?? [])
      .filter((g: { scope_type: string; role: string }) => g.scope_type === 'org' && g.role === 'org_admin')
      .map((g: { org_id: string }) => g.org_id)
      .filter(Boolean);

    const isCallerOrgAdmin = callerOrgIds.length > 0;

    if (!callerProfile?.is_platform_admin && !isCallerOrgAdmin) {
      return json({ error: 'Forbidden' }, 403);
    }

    const { email, full_name, phone, grant } = await req.json();
    if (!email?.trim() || !full_name?.trim()) {
      return json({ error: 'email and full_name are required' }, 400);
    }

    // Org admins cannot grant org-level access and can only invite to their own buildings
    if (!callerProfile?.is_platform_admin && isCallerOrgAdmin) {
      if (grant?.org_id) {
        return json({ error: 'Forbidden — org admins cannot grant org-level roles' }, 403);
      }
      if (grant?.building_id) {
        const { data: ob } = await admin
          .from('org_buildings')
          .select('building_id')
          .in('org_id', callerOrgIds)
          .eq('building_id', grant.building_id)
          .maybeSingle();
        if (!ob) return json({ error: 'Forbidden — building not in your org' }, 403);
      }
    }

    // Invite the user — Supabase sends a magic-link email; user clicks it to activate
    const { data: invite, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      email.trim().toLowerCase(),
      {
        redirectTo: appUrl,
        data: { full_name: full_name.trim() },
      },
    );

    if (inviteErr) {
      // User already registered — tell the admin to use the Access panel instead
      if (inviteErr.message?.toLowerCase().includes('already')) {
        return json({
          error: 'A user with this email already exists. Use the Access tab to assign them a role.',
          code: 'already_exists',
        }, 409);
      }
      return json({ error: inviteErr.message }, 400);
    }

    const userId = invite.user.id;

    // Upsert profile (a DB trigger may already have created the row on invite)
    await admin.from('profiles').upsert(
      {
        id: userId,
        full_name: full_name.trim(),
        phone: phone?.trim() || null,
        status: 'active',
        role: 'resident',
        notify_email: true,
        notify_whatsapp: false,
      },
      { onConflict: 'id' },
    );

    // Insert the access grant if the caller requested one
    if (grant?.role && (grant?.building_id || grant?.org_id)) {
      const { error: grantErr } = await admin.from('grants').insert({
        user_id: userId,
        scope_type: grant.org_id ? 'org' : 'building',
        org_id: grant.org_id ?? null,
        building_id: grant.building_id ?? null,
        role: grant.role,
      });
      if (grantErr) console.error('Grant insert error:', grantErr.message);
    }

    return json({ success: true, user_id: userId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return json({ error: msg }, 500);
  }
});
