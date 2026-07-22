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

// Roles a building admin may hand out (strictly below building_admin).
const BELOW_BUILDING_ADMIN = ['building_finance', 'building_super', 'viewer'];
// Roles a compound admin may hand out at building level (below compound_admin).
const BELOW_COMPOUND_ADMIN = ['building_admin', ...BELOW_BUILDING_ADMIN];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5173';

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Caller identity & scope ─────────────────────────────────────────────
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
      .select('scope_type, role, org_id, building_id, compound_id')
      .eq('user_id', caller.id);

    const isPlatform = !!callerProfile?.is_platform_admin;
    const grantsList = (callerGrants ?? []) as { scope_type: string; role: string; org_id: string | null; building_id: string | null; compound_id: string | null }[];
    const callerOrgIds = grantsList.filter(g => g.scope_type === 'org' && g.role === 'org_admin').map(g => g.org_id).filter(Boolean) as string[];
    const callerCompoundIds = grantsList.filter(g => g.scope_type === 'compound' && g.role === 'compound_admin').map(g => g.compound_id).filter(Boolean) as string[];
    const callerBuildingIds = grantsList.filter(g => g.scope_type === 'building' && g.role === 'building_admin').map(g => g.building_id).filter(Boolean) as string[];

    const isOrgAdmin = callerOrgIds.length > 0;
    const isCompoundAdmin = callerCompoundIds.length > 0;
    const isBuildingAdmin = callerBuildingIds.length > 0;

    if (!isPlatform && !isOrgAdmin && !isCompoundAdmin && !isBuildingAdmin) {
      return json({ error: 'Forbidden' }, 403);
    }

    const { email, full_name, phone, grant, building_id, mode } = await req.json();
    if (!email?.trim() || !full_name?.trim()) {
      return json({ error: 'email and full_name are required' }, 400);
    }

    // "Is this building inside the caller's territory?"
    async function buildingInScope(bid: string): Promise<boolean> {
      if (isPlatform) return true;
      if (callerBuildingIds.includes(bid)) return true;
      if (callerCompoundIds.length) {
        const { data } = await admin.from('buildings').select('id')
          .eq('id', bid).in('compound_id', callerCompoundIds).maybeSingle();
        if (data) return true;
      }
      if (callerOrgIds.length) {
        const { data } = await admin.from('org_buildings').select('building_id')
          .in('org_id', callerOrgIds).eq('building_id', bid).maybeSingle();
        if (data) return true;
      }
      return false;
    }

    // ── Authorization of the requested grant ────────────────────────────────
    if (!isPlatform && grant?.role) {
      if (grant.org_id) {
        return json({ error: 'Forbidden — only the platform operator can grant org-level roles' }, 403);
      }
      if (grant.compound_id) {
        // Compound-level roles: org admins only, within their org.
        if (!isOrgAdmin) return json({ error: 'Forbidden — you cannot grant compound-level roles' }, 403);
        const { data: oc } = await admin.from('compounds').select('id')
          .in('org_id', callerOrgIds).eq('id', grant.compound_id).maybeSingle();
        if (!oc) return json({ error: 'Forbidden — compound not in your org' }, 403);
      }
      if (grant.building_id) {
        if (!(await buildingInScope(grant.building_id))) {
          return json({ error: 'Forbidden — building not in your scope' }, 403);
        }
        // The grants ladder (0026) is bypassed by the service role, so enforce it here:
        // callers may only hand out roles BELOW their own level.
        if (!isOrgAdmin) {
          const allowed = isCompoundAdmin ? BELOW_COMPOUND_ADMIN : BELOW_BUILDING_ADMIN;
          if (!allowed.includes(grant.role)) {
            return json({ error: `Forbidden — you cannot grant the "${grant.role}" role` }, 403);
          }
        }
      }
    }

    // ── Authorization of the resident's home building ───────────────────────
    if (building_id && !(await buildingInScope(building_id))) {
      return json({ error: 'Forbidden — building not in your scope' }, 403);
    }

    // ── Invite ──────────────────────────────────────────────────────────────
    const { data: invite, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      email.trim().toLowerCase(),
      {
        redirectTo: appUrl,
        data: { full_name: full_name.trim() },
      },
    );

    if (inviteErr) {
      if (inviteErr.message?.toLowerCase().includes('already')) {
        // Import mode: look up the existing user and return their ID so the caller can create a membership
        if (mode === 'import') {
          const { data: existing } = await admin.auth.admin.getUserByEmail(email.trim().toLowerCase());
          if (existing?.user) {
            return json({ success: true, user_id: existing.user.id, existing: true });
          }
        }
        return json({
          error: 'A user with this email already exists. Use the Access tab to assign them a role.',
          code: 'already_exists',
        }, 409);
      }
      return json({ error: inviteErr.message }, 400);
    }

    const userId = invite.user.id;

    // Upsert profile (a DB trigger may already have created the row on invite).
    // building_id makes the person visible in the admin's People list — for a
    // plain resident it comes from the body; for building roles, from the grant.
    await admin.from('profiles').upsert(
      {
        id: userId,
        full_name: full_name.trim(),
        phone: phone?.trim() || null,
        building_id: building_id ?? grant?.building_id ?? null,
        status: 'active',
        role: 'resident',
        notify_email: true,
        notify_whatsapp: false,
      },
      { onConflict: 'id' },
    );

    // Insert the access grant if the caller requested one
    if (grant?.role && (grant?.building_id || grant?.org_id || grant?.compound_id)) {
      const scope_type = grant.org_id ? 'org' : grant.compound_id ? 'compound' : 'building';
      const { error: grantErr } = await admin.from('grants').insert({
        user_id: userId,
        scope_type,
        org_id: grant.org_id ?? null,
        building_id: grant.building_id ?? null,
        compound_id: grant.compound_id ?? null,
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
