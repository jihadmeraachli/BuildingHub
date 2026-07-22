import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { rolesHaveCap } from '@/lib/permissions';
import type { Profile, Grant, Membership, Capability, GrantRole } from '@/types';

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  // --- v3 permission model (additive) ---
  grants: Grant[];
  memberships: Membership[];
  isPlatformAdmin: boolean;
  /** building_id -> roles the user effectively holds for it (org grants cascaded in) */
  buildingRoles: Record<string, GrantRole[]>;
  /** can the current user perform `cap` on `buildingId`? */
  can: (cap: Capability, buildingId: string | null | undefined) => boolean;
  /** does the user have `cap` on ANY building (or is platform admin)? — for nav gating */
  canAny: (cap: Capability) => boolean;
  /** building ids the user has any management grant on (super admin = handled by caller) */
  manageableBuildingIds: string[];
  /** unit ids the current user owns/occupies */
  myUnitIds: string[];
  /** unit ids where the user is specifically the owner */
  myOwnerUnitIds: string[];
  /** unit ids where the user is specifically a tenant */
  myTenantUnitIds: string[];
  /** true when the user is a resident-only account and NONE of their units holds an active license (0031) */
  needsLicense: boolean;
  /** true when the user has 2FA enrolled but this session hasn't passed the code check yet */
  mfaPending: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [buildingRoles, setBuildingRoles] = useState<Record<string, GrantRole[]>>({});
  const [loading, setLoading] = useState(true);
  // null = not applicable (managers, no residency); false = resident with no licensed unit
  const [residentLicensed, setResidentLicensed] = useState<boolean | null>(null);
  const [mfaPending, setMfaPending] = useState(false);

  // 2FA gate: a password-only session (aal1) on an account with a verified TOTP
  // factor must not reach the app until the code is entered (aal2).
  async function checkMfaLevel() {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setMfaPending(data?.nextLevel === 'aal2' && data.currentLevel !== 'aal2');
  }

  async function fetchProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    const p = (data as Profile) ?? null;

    // Deactivated accounts must not hold a session — otherwise "deactivate"
    // is only a badge. Kick them straight back out to Login. (Migration 0026.)
    if (p?.status === 'inactive') {
      await supabase.auth.signOut();
      setProfile(null);
      toast.error('Your account has been deactivated. Please contact your building admin.');
      return;
    }

    setProfile(p);
  }

  async function fetchAccess(userId: string) {
    // Grants + memberships for the user; org grants are cascaded to buildings below.
    const [{ data: grantData }, { data: memberData }] = await Promise.all([
      supabase.from('grants').select('*').eq('user_id', userId),
      // only ACTIVE residency — a moved-out member keeps history but loses access (0026)
      supabase.from('memberships').select('*, unit:units(*)').eq('user_id', userId).is('ended_at', null),
    ]);

    const g = (grantData as Grant[]) ?? [];
    const m = (memberData as Membership[]) ?? [];
    setGrants(g);
    setMemberships(m);

    // License gate (0031): resident-only accounts need at least one unit with an
    // active license. No unit at all counts as blocked too — an account nobody
    // has linked to a unit has nothing to see (mid-onboarding admins are
    // exempted in the provider via pending_onboarding metadata). Managers and
    // mixed accounts are never blocked client-side — the DB (RLS) remains the
    // real enforcement; this only drives the /no-license UX.
    if (g.length === 0 && m.length === 0) {
      setResidentLicensed(false);
    } else if (g.length === 0) {
      try {
        const checks = await Promise.all(
          m.map((mem) => supabase.rpc('unit_has_active_license', { p_unit_id: mem.unit_id })),
        );
        // Fail open on RPC errors (e.g. migration not yet applied) — DB is the source of truth.
        const anyLicensed = checks.some((r) => r.error || r.data === true);
        setResidentLicensed(anyLicensed);
      } catch {
        setResidentLicensed(null);
      }
    } else {
      setResidentLicensed(null);
    }

    // Resolve building -> roles (cascade org grants through org_buildings).
    const roles: Record<string, GrantRole[]> = {};
    const add = (bid: string, role: GrantRole) => {
      (roles[bid] ??= []).push(role);
    };
    for (const grant of g) {
      if (grant.scope_type === 'building' && grant.building_id) add(grant.building_id, grant.role);
    }
    // Cascade COMPOUND grants → every block in that compound, including blocks
    // added after the grant was made. Mirrors user_can() in SQL (0027).
    const compoundIds = g.filter((x) => x.scope_type === 'compound' && x.compound_id).map((x) => x.compound_id as string);
    if (compoundIds.length) {
      const { data: blocks } = await supabase
        .from('buildings')
        .select('id, compound_id')
        .in('compound_id', compoundIds);
      for (const row of (blocks as { id: string; compound_id: string }[]) ?? []) {
        for (const grant of g) {
          if (grant.scope_type === 'compound' && grant.compound_id === row.compound_id) add(row.id, grant.role);
        }
      }
    }

    const orgIds = g.filter((x) => x.scope_type === 'org' && x.org_id).map((x) => x.org_id as string);
    if (orgIds.length) {
      const { data: ob } = await supabase
        .from('org_buildings')
        .select('org_id, building_id')
        .in('org_id', orgIds);
      for (const row of (ob as { org_id: string; building_id: string }[]) ?? []) {
        for (const grant of g) {
          if (grant.scope_type === 'org' && grant.org_id === row.org_id) add(row.building_id, grant.role);
        }
      }
    }
    setBuildingRoles(roles);
  }

  const loadAll = useCallback(async (userId: string) => {
    await Promise.all([fetchProfile(userId), fetchAccess(userId)]);
  }, []);

  async function refreshProfile() {
    if (user) await loadAll(user.id);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        checkMfaLevel();
        loadAll(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        // setTimeout: auth calls inside this callback can deadlock on the client's
        // internal lock — defer to the next tick.
        setTimeout(checkMfaLevel, 0);
        loadAll(session.user.id);
      } else {
        setMfaPending(false);
        setProfile(null);
        setGrants([]);
        setMemberships([]);
        setBuildingRoles({});
        setResidentLicensed(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [loadAll]);

  async function signOut() {
    await supabase.auth.signOut();
  }

  const isPlatformAdmin = !!profile?.is_platform_admin;

  const can = useCallback(
    (cap: Capability, buildingId: string | null | undefined): boolean => {
      if (isPlatformAdmin) return true;
      if (!buildingId) return false;
      return rolesHaveCap(buildingRoles[buildingId] ?? [], cap);
    },
    [isPlatformAdmin, buildingRoles],
  );

  const canAny = useCallback(
    (cap: Capability): boolean => {
      if (isPlatformAdmin) return true;
      return Object.values(buildingRoles).some((roles) => rolesHaveCap(roles, cap));
    },
    [isPlatformAdmin, buildingRoles],
  );

  const manageableBuildingIds = Object.keys(buildingRoles);
  // Admins mid-registration (email confirmed, entity not yet created) have no
  // grants/units yet — they belong on /register, not behind the license wall.
  const pendingOnboarding = !!user?.user_metadata?.pending_onboarding;
  const needsLicense = !isPlatformAdmin && !pendingOnboarding && residentLicensed === false;
  const myUnitIds = memberships.map((m) => m.unit_id);
  const myOwnerUnitIds = memberships.filter((m) => m.tenure === 'owner').map((m) => m.unit_id);
  const myTenantUnitIds = memberships.filter((m) => m.tenure === 'tenant').map((m) => m.unit_id);

  return (
    <AuthContext.Provider
      value={{
        user, profile, session, loading, signOut, refreshProfile,
        grants, memberships, isPlatformAdmin, buildingRoles, can, canAny,
        manageableBuildingIds, myUnitIds, myOwnerUnitIds, myTenantUnitIds, needsLicense, mfaPending,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
