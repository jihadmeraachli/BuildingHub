import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
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

  async function fetchProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    setProfile((data as Profile) ?? null);
  }

  async function fetchAccess(userId: string) {
    // Grants + memberships for the user; org grants are cascaded to buildings below.
    const [{ data: grantData }, { data: memberData }] = await Promise.all([
      supabase.from('grants').select('*').eq('user_id', userId),
      supabase.from('memberships').select('*, unit:units(*)').eq('user_id', userId),
    ]);

    const g = (grantData as Grant[]) ?? [];
    const m = (memberData as Membership[]) ?? [];
    setGrants(g);
    setMemberships(m);

    // Resolve building -> roles (cascade org grants through org_buildings).
    const roles: Record<string, GrantRole[]> = {};
    const add = (bid: string, role: GrantRole) => {
      (roles[bid] ??= []).push(role);
    };
    for (const grant of g) {
      if (grant.scope_type === 'building' && grant.building_id) add(grant.building_id, grant.role);
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
        loadAll(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadAll(session.user.id);
      } else {
        setProfile(null);
        setGrants([]);
        setMemberships([]);
        setBuildingRoles({});
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
  const myUnitIds = memberships.map((m) => m.unit_id);
  const myOwnerUnitIds = memberships.filter((m) => m.tenure === 'owner').map((m) => m.unit_id);
  const myTenantUnitIds = memberships.filter((m) => m.tenure === 'tenant').map((m) => m.unit_id);

  return (
    <AuthContext.Provider
      value={{
        user, profile, session, loading, signOut, refreshProfile,
        grants, memberships, isPlatformAdmin, buildingRoles, can, canAny,
        manageableBuildingIds, myUnitIds, myOwnerUnitIds, myTenantUnitIds,
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
