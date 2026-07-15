import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Mail, Network, Shield, Trash2, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Profile, UserRole, UserStatus, Building, Grant, GrantRole, Organization } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { SkeletonTable } from '@/components/ui/Skeleton';

type Tab = 'all' | 'pending' | 'access';
type GrantScope = 'building' | 'org';
type InviteScopeType = 'none' | 'building' | 'org';

type GrantRow = Grant & {
  profiles: { id: string; full_name: string; apartment_number: string | null } | null;
};

const BUILDING_ROLES: GrantRole[] = ['building_admin', 'building_finance', 'viewer'];
const ORG_ROLES: GrantRole[] = ['org_admin', 'org_finance'];

const roleColor: Record<UserRole, 'blue' | 'orange' | 'slate'> = {
  super_admin: 'blue', building_admin: 'orange', resident: 'slate',
};
const statusColor: Record<UserStatus, 'green' | 'yellow' | 'red' | 'slate'> = {
  active: 'green', pending: 'yellow', rejected: 'red', inactive: 'slate',
};
const grantRoleColor: Record<string, 'blue' | 'orange' | 'slate'> = {
  building_admin: 'blue', org_admin: 'blue',
  building_finance: 'orange', org_finance: 'orange',
  viewer: 'slate',
};

export default function Users() {
  const { t } = useTranslation();
  const { profile, isPlatformAdmin, can, canAny, grants: authGrants } = useAuth();
  const isSuperAdmin = isPlatformAdmin;
  const isOrgAdmin = !isPlatformAdmin && authGrants.some(g => g.scope_type === 'org' && g.role === 'org_admin');
  const myOrgIds = authGrants.filter(g => g.scope_type === 'org' && g.role === 'org_admin').map(g => g.org_id as string).filter(Boolean);
  const showBuildingSelector = isSuperAdmin || isOrgAdmin;

  const [users, setUsers] = useState<Profile[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('');
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const [grantScope, setGrantScope] = useState<GrantScope>('building');
  const [assigned, setAssigned] = useState<Record<string, { label: string; tenure: string }[]>>({});

  // Building grants
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [grantLoading, setGrantLoading] = useState(false);
  const [grantModal, setGrantModal] = useState(false);
  // deactivate confirmation (real modal — window.prompt is blocked in sandboxed iframes)
  const [deactivateTarget, setDeactivateTarget] = useState<Profile | null>(null);
  const [deactivateReason, setDeactivateReason] = useState('');
  const [deactivating, setDeactivating] = useState(false);
  // hard delete (platform admin only) — blockers come from can_delete_user()
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deleteBlockers, setDeleteBlockers] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [grantUserId, setGrantUserId] = useState('');
  const [grantRole, setGrantRole] = useState<GrantRole>('building_finance');
  const [grantSearch, setGrantSearch] = useState('');

  // Org grants
  const [orgGrants, setOrgGrants] = useState<GrantRow[]>([]);
  const [orgGrantLoading, setOrgGrantLoading] = useState(false);
  const [orgGrantModal, setOrgGrantModal] = useState(false);
  const [orgGrantUserId, setOrgGrantUserId] = useState('');
  const [orgGrantRole, setOrgGrantRole] = useState<GrantRole>('org_admin');
  const [orgGrantSearch, setOrgGrantSearch] = useState('');

  // Invite new user
  const [inviteModal, setInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFullName, setInviteFullName] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteScopeType, setInviteScopeType] = useState<InviteScopeType>('none');
  const [inviteGrantRole, setInviteGrantRole] = useState<GrantRole>('building_admin');
  const [inviteBuildingId, setInviteBuildingId] = useState('');
  const [inviteOrgId, setInviteOrgId] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  useEffect(() => {
    if (!showBuildingSelector) return;
    if (isSuperAdmin) {
      Promise.all([
        supabase.from('buildings').select('*').eq('is_active', true).order('name'),
        supabase.from('organizations').select('*').eq('is_active', true).order('name'),
      ]).then(([{ data: b }, { data: o }]) => {
        setBuildings(b ?? []);
        setOrganizations(o ?? []);
      });
    } else if (isOrgAdmin && myOrgIds.length) {
      supabase.from('org_buildings').select('buildings(*)').in('org_id', myOrgIds)
        .then(({ data }) => {
          const b = ((data ?? []) as unknown as { buildings: Building }[]).map(r => r.buildings).filter(Boolean);
          setBuildings(b);
        });
    }
  }, [isSuperAdmin, isOrgAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeBuildingId = showBuildingSelector ? selectedBuildingId : profile?.building_id ?? '';
  const canManageAccess = isPlatformAdmin || (activeBuildingId ? can('grant.manage', activeBuildingId) : canAny('grant.manage'));

  useEffect(() => {
    if (activeBuildingId && tab !== 'access') loadUsers();
  }, [activeBuildingId, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeBuildingId && tab === 'access' && grantScope === 'building') loadGrants();
  }, [activeBuildingId, tab, grantScope]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedOrgId && tab === 'access' && grantScope === 'org') loadOrgGrants();
  }, [selectedOrgId, tab, grantScope]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadUsers() {
    setLoading(true);
    let q = supabase.from('profiles').select('*').eq('building_id', activeBuildingId);
    if (tab === 'pending') q = q.eq('status', 'pending');
    q = q.order('created_at', { ascending: false });
    const { data } = await q;
    setUsers(data ?? []);
    setLoading(false);

    const { data: us } = await supabase.from('units').select('id, label').eq('building_id', activeBuildingId);
    const unitList = (us as { id: string; label: string }[]) ?? [];
    const unitLabel = Object.fromEntries(unitList.map((u) => [u.id, u.label]));
    if (unitList.length) {
      const { data: ms } = await supabase.from('memberships').select('user_id, unit_id, tenure').in('unit_id', unitList.map((u) => u.id)).is('ended_at', null);
      const map: Record<string, { label: string; tenure: string }[]> = {};
      (ms as { user_id: string; unit_id: string; tenure: string }[] ?? []).forEach((m) => {
        (map[m.user_id] ??= []).push({ label: unitLabel[m.unit_id], tenure: m.tenure ?? 'owner' });
      });
      setAssigned(map);
    } else setAssigned({});
  }

  async function loadGrants() {
    if (!activeBuildingId) return;
    setGrantLoading(true);
    const { data } = await supabase
      .from('grants').select('*, profiles(id, full_name, apartment_number)')
      .eq('building_id', activeBuildingId).eq('scope_type', 'building').order('created_at');
    setGrants((data as GrantRow[]) ?? []);
    setGrantLoading(false);
  }

  async function loadOrgGrants() {
    if (!selectedOrgId) return;
    setOrgGrantLoading(true);
    const { data } = await supabase
      .from('grants').select('*, profiles(id, full_name, apartment_number)')
      .eq('org_id', selectedOrgId).eq('scope_type', 'org').order('created_at');
    setOrgGrants((data as GrantRow[]) ?? []);
    setOrgGrantLoading(false);
  }

  async function openGrantModal() {
    const { data } = await supabase.from('profiles').select('*').eq('status', 'active').order('full_name');
    setAllProfiles(data ?? []);
    setGrantUserId(''); setGrantRole('building_finance'); setGrantSearch('');
    setGrantModal(true);
  }

  async function openOrgGrantModal() {
    const { data } = await supabase.from('profiles').select('*').eq('status', 'active').order('full_name');
    setAllProfiles(data ?? []);
    setOrgGrantUserId(''); setOrgGrantRole('org_admin'); setOrgGrantSearch('');
    setOrgGrantModal(true);
  }

  async function addGrant() {
    if (!grantUserId || !activeBuildingId) return;
    const { error } = await supabase.from('grants').insert({
      user_id: grantUserId, scope_type: 'building', building_id: activeBuildingId, org_id: null, role: grantRole,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.grantAdded'));
    setGrantModal(false); loadGrants();
  }

  async function addOrgGrant() {
    if (!orgGrantUserId || !selectedOrgId) return;
    const { error } = await supabase.from('grants').insert({
      user_id: orgGrantUserId, scope_type: 'org', org_id: selectedOrgId, building_id: null, role: orgGrantRole,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.grantAdded'));
    setOrgGrantModal(false); loadOrgGrants();
  }

  async function removeGrant(id: string) {
    const { error } = await supabase.from('grants').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.grantRemoved')); loadGrants();
  }

  async function removeOrgGrant(id: string) {
    const { error } = await supabase.from('grants').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.grantRemoved')); loadOrgGrants();
  }

  async function updateUser(id: string, patch: Partial<Profile>) {
    // Surface DB guard errors (0026) instead of silently claiming success.
    const { error } = await supabase.from('profiles').update(patch).eq('id', id);
    if (error) { toast.error(error.message); return; }
    if (patch.status === 'active') toast.success(t('users.approved'));
    else if (patch.status === 'rejected') toast.success(t('users.rejected'));
    loadUsers();
  }

  // Deactivate = the safe default. Guards live in the DB (0026): no self-deactivation,
  // no deactivating at/above your level, no orphaning a building's last admin.
  // NB: uses a real modal, not window.prompt() — native dialogs are suppressed in
  // sandboxed iframes (VS Code Simple Browser) and return null silently.
  async function confirmDeactivate() {
    if (!deactivateTarget) return;
    setDeactivating(true);
    const { error } = await supabase.rpc('deactivate_user', {
      p_target: deactivateTarget.id,
      p_reason: deactivateReason.trim() || null,
    });
    setDeactivating(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.deactivated'));
    setDeactivateTarget(null);
    loadUsers();
  }

  async function reactivateUser(id: string) {
    const { error } = await supabase.rpc('reactivate_user', { p_target: id });
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.reactivated'));
    loadUsers();
  }

  // Hard delete — platform admin only. Opening the modal asks the DB why it might be
  // blocked (can_delete_user) so we can SHOW the reasons instead of failing blindly.
  // Modal, not confirm(): native dialogs are suppressed in sandboxed iframes.
  async function openDelete(u: Profile) {
    setDeleteTarget(u);
    setDeleteBlockers(null); // null = still checking
    const { data, error } = await supabase.rpc('can_delete_user', { p_target: u.id });
    if (error) { toast.error(error.message); setDeleteTarget(null); return; }
    setDeleteBlockers((data as string[]) ?? []);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.rpc('delete_user', { p_target: deleteTarget.id });
    setDeleting(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.deleted'));
    setDeleteTarget(null);
    loadUsers();
  }

  function openInviteModal() {
    setInviteEmail(''); setInviteFullName(''); setInvitePhone('');
    setInviteScopeType('none'); setInviteGrantRole('building_admin');
    setInviteBuildingId(''); setInviteOrgId('');
    setInviteModal(true);
  }

  async function sendInvite() {
    if (!inviteEmail.trim() || !inviteFullName.trim()) return;
    setInviteLoading(true);

    const grant =
      inviteScopeType === 'building' && inviteBuildingId
        ? { role: inviteGrantRole, building_id: inviteBuildingId, org_id: null }
        : inviteScopeType === 'org' && inviteOrgId
        ? { role: inviteGrantRole, org_id: inviteOrgId, building_id: null }
        : null;

    const { error } = await supabase.functions.invoke('invite-user', {
      body: {
        email: inviteEmail.trim(),
        full_name: inviteFullName.trim(),
        phone: invitePhone.trim() || null,
        grant,
      },
    });

    setInviteLoading(false);

    if (error) {
      toast.error(error.message ?? t('users.inviteError'));
      return;
    }

    toast.success(t('users.inviteSent', { email: inviteEmail.trim() }));
    setInviteModal(false);
  }

  const pendingCount = users.filter(u => u.status === 'pending').length;
  const grantedUserIds = new Set(grants.map(g => g.user_id));
  const orgGrantedUserIds = new Set(orgGrants.map(g => g.user_id));

  const availableProfiles = allProfiles
    .filter(p => !grantedUserIds.has(p.id))
    .filter(p => p.full_name.toLowerCase().includes(grantSearch.toLowerCase()) || (p.apartment_number ?? '').toLowerCase().includes(grantSearch.toLowerCase()));

  const availableProfilesForOrg = allProfiles
    .filter(p => !orgGrantedUserIds.has(p.id))
    .filter(p => p.full_name.toLowerCase().includes(orgGrantSearch.toLowerCase()) || (p.apartment_number ?? '').toLowerCase().includes(orgGrantSearch.toLowerCase()));

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'all', label: t('users.allUsers'), show: true },
    { key: 'pending', label: t('users.pendingApprovals'), show: true },
    { key: 'access', label: t('users.accessTab'), show: canManageAccess },
  ];

  const onOrgScope = tab === 'access' && grantScope === 'org' && isSuperAdmin;
  const showContent = !!activeBuildingId || isSuperAdmin;

  const rolesForInviteScope = inviteScopeType === 'org' ? ORG_ROLES : BUILDING_ROLES;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <h1 className="text-xl font-semibold text-slate-900">{t('users.title')}</h1>
        <div className="flex gap-2">
          {(isSuperAdmin || isOrgAdmin) && (
            <Button variant="secondary" onClick={openInviteModal}>
              <Mail size={16} /> {t('users.inviteUser')}
            </Button>
          )}
          {tab === 'access' && canManageAccess && (
            onOrgScope ? (
              <Button onClick={openOrgGrantModal} disabled={!selectedOrgId}>
                <UserPlus size={16} /> {t('users.addOrgAccess')}
              </Button>
            ) : activeBuildingId ? (
              <Button onClick={openGrantModal}><UserPlus size={16} /> {t('users.addAccess')}</Button>
            ) : null
          )}
        </div>
      </div>

      {showBuildingSelector && (
        <div className="mb-4">
          <select
            value={selectedBuildingId}
            onChange={e => { setSelectedBuildingId(e.target.value); setTab('all'); }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[240px]"
          >
            <option value="">{t('common.selectBuilding')}</option>
            {buildings.map(b => (
              <option key={b.id} value={b.id}>{b.name} ({b.city})</option>
            ))}
          </select>
        </div>
      )}

      {!showContent ? (
        <Card><CardBody>
          <p className="text-sm text-slate-500 text-center py-8">{t('users.selectBuildingHint')}</p>
        </CardBody></Card>
      ) : (
        <>
          <div className="flex gap-2 mb-4">
            {tabs.filter(t3 => t3.show).map(t3 => (
              <button
                key={t3.key}
                onClick={() => setTab(t3.key)}
                className={`text-sm px-4 py-1.5 rounded-lg border transition cursor-pointer ${tab === t3.key ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
              >
                {t3.label}
                {t3.key === 'pending' && pendingCount > 0 && (
                  <span className="ms-1.5 bg-yellow-400 text-yellow-900 text-xs rounded-full px-1.5">{pendingCount}</span>
                )}
              </button>
            ))}
          </div>

          {tab === 'access' ? (
            <div className="space-y-4">
              {isSuperAdmin && (
                <div className="flex gap-1">
                  <button
                    onClick={() => setGrantScope('building')}
                    className={`text-sm px-4 py-1.5 rounded-lg border transition cursor-pointer ${grantScope === 'building' ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
                  >
                    {t('users.scopeBuilding')}
                  </button>
                  <button
                    onClick={() => setGrantScope('org')}
                    className={`text-sm px-4 py-1.5 rounded-lg border transition cursor-pointer ${grantScope === 'org' ? 'bg-violet-600 border-violet-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
                  >
                    <span className="flex items-center gap-1.5"><Network size={13} /> {t('users.scopeOrg')}</span>
                  </button>
                </div>
              )}
              {/* org admins stay on building scope only — no org-level grant management */}

              {grantScope === 'org' && isSuperAdmin ? (
                <>
                  <select
                    value={selectedOrgId}
                    onChange={e => setSelectedOrgId(e.target.value)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 min-w-[280px]"
                  >
                    <option value="">{t('users.selectOrgHint')}</option>
                    {organizations.map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>

                  {!selectedOrgId ? (
                    <Card><CardBody>
                      <div className="text-center py-10">
                        <Network size={32} className="mx-auto text-slate-300 mb-2" />
                        <p className="text-sm text-slate-500">{t('users.selectOrgHint')}</p>
                      </div>
                    </CardBody></Card>
                  ) : orgGrantLoading ? (
                    <SkeletonTable rows={3} cols={3} />
                  ) : orgGrants.length === 0 ? (
                    <Card><CardBody>
                      <div className="text-center py-10">
                        <Shield size={32} className="mx-auto text-slate-300 mb-2" />
                        <p className="text-sm text-slate-500">{t('users.noOrgGrants')}</p>
                      </div>
                    </CardBody></Card>
                  ) : (
                    <Card>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wide">
                              <th className="px-4 py-3 text-start font-medium">{t('users.name')}</th>
                              <th className="px-4 py-3 text-start font-medium">{t('users.role')}</th>
                              <th className="px-4 py-3 text-start font-medium">{t('common.actions')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {orgGrants.map(g => (
                              <tr key={g.id} className="hover:bg-slate-50">
                                <td className="px-4 py-3">
                                  <p className="font-medium text-slate-900">{g.profiles?.full_name ?? '—'}</p>
                                </td>
                                <td className="px-4 py-3">
                                  <Badge color={grantRoleColor[g.role] ?? 'slate'}>
                                    {t(`users.roles.${g.role}`, { defaultValue: g.role })}
                                  </Badge>
                                </td>
                                <td className="px-4 py-3">
                                  <button onClick={() => removeOrgGrant(g.id)} className="text-slate-300 hover:text-red-500 transition cursor-pointer" title={t('users.revokeAccess')}>
                                    <Trash2 size={15} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}
                </>
              ) : (
                !activeBuildingId ? (
                  <Card><CardBody>
                    <p className="text-sm text-slate-500 text-center py-8">{t('users.selectBuildingHint')}</p>
                  </CardBody></Card>
                ) : grantLoading ? (
                  <SkeletonTable rows={4} cols={3} />
                ) : grants.length === 0 ? (
                  <Card><CardBody>
                    <div className="text-center py-10">
                      <Shield size={32} className="mx-auto text-slate-300 mb-2" />
                      <p className="text-sm text-slate-500">{t('users.noGrants')}</p>
                    </div>
                  </CardBody></Card>
                ) : (
                  <Card>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wide">
                            <th className="px-4 py-3 text-start font-medium">{t('users.name')}</th>
                            <th className="px-4 py-3 text-start font-medium">{t('users.role')}</th>
                            <th className="px-4 py-3 text-start font-medium">{t('common.actions')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {grants.map(g => (
                            <tr key={g.id} className="hover:bg-slate-50">
                              <td className="px-4 py-3">
                                <p className="font-medium text-slate-900">{g.profiles?.full_name ?? '—'}</p>
                                {g.profiles?.apartment_number && (
                                  <p className="text-xs text-slate-400">Apt {g.profiles.apartment_number}</p>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <Badge color={grantRoleColor[g.role] ?? 'slate'}>
                                  {t(`users.roles.${g.role}`, { defaultValue: g.role })}
                                </Badge>
                              </td>
                              <td className="px-4 py-3">
                                <button onClick={() => removeGrant(g.id)} className="text-slate-300 hover:text-red-500 transition cursor-pointer" title={t('users.revokeAccess')}>
                                  <Trash2 size={15} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )
              )}
            </div>
          ) : (
            !activeBuildingId ? (
              <Card><CardBody><p className="text-sm text-slate-500 text-center py-8">{t('users.selectBuildingHint')}</p></CardBody></Card>
            ) : loading ? (
              <SkeletonTable rows={5} cols={6} />
            ) : users.length === 0 ? (
              <Card><CardBody><p className="text-sm text-slate-500 text-center py-8">{t('users.noUsers')}</p></CardBody></Card>
            ) : (
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wide">
                        <th className="px-4 py-3 text-start font-medium">{t('users.name')}</th>
                        <th className="px-4 py-3 text-start font-medium">{t('users.apartment')}</th>
                        <th className="px-4 py-3 text-start font-medium">{t('users.role')}</th>
                        <th className="px-4 py-3 text-start font-medium">{t('users.status')}</th>
                        <th className="px-4 py-3 text-start font-medium">{t('users.notifications')}</th>
                        <th className="px-4 py-3 text-start font-medium">{t('common.actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {users.map(u => (
                        <tr key={u.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{u.full_name}</p>
                            <p className="text-xs text-slate-400">{u.phone ?? '—'}</p>
                          </td>
                          <td className="px-4 py-3">
                            {assigned[u.id]?.length ? (
                              <div className="flex flex-wrap gap-1">
                                {assigned[u.id].map((m) => (
                                  <span key={m.label} className={`text-xs rounded-full px-2 py-0.5 ${m.tenure === 'tenant' ? 'bg-amber-50 text-amber-700' : 'bg-indigo-50 text-indigo-700'}`}>{m.label}</span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-400">{u.apartment_number ?? '—'}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {isSuperAdmin ? (
                              <select
                                value={u.role}
                                onChange={e => updateUser(u.id, { role: e.target.value as UserRole })}
                                className="rounded border border-slate-300 px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                              >
                                <option value="resident">{t('users.roles.resident')}</option>
                                <option value="building_admin">{t('users.roles.building_admin')}</option>
                              </select>
                            ) : (
                              <Badge color={roleColor[u.role]}>{t(`users.roles.${u.role}`)}</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge color={statusColor[u.status]}>{t(`users.statuses.${u.status}`)}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                                <input type="checkbox" checked={u.notify_email} onChange={e => updateUser(u.id, { notify_email: e.target.checked })} className="rounded" />
                                {t('users.notifyEmail')}
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                                <input type="checkbox" checked={u.notify_whatsapp} onChange={e => updateUser(u.id, { notify_whatsapp: e.target.checked })} className="rounded" />
                                {t('users.notifyWhatsapp')}
                              </label>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {u.status === 'pending' && (
                                <>
                                  <Button size="sm" onClick={() => updateUser(u.id, { status: 'active' })}>{t('users.approve')}</Button>
                                  <Button size="sm" variant="danger" onClick={() => updateUser(u.id, { status: 'rejected' })}>{t('users.reject')}</Button>
                                </>
                              )}
                              {u.status === 'active' && u.id !== profile?.id && (
                                <Button size="sm" variant="secondary" onClick={() => { setDeactivateReason(''); setDeactivateTarget(u); }}>{t('users.deactivate')}</Button>
                              )}
                              {u.status === 'inactive' && (
                                <Button size="sm" onClick={() => reactivateUser(u.id)}>{t('common.reactivate')}</Button>
                              )}
                              {/* Hard delete: platform admin only, never self. Guards enforced in DB (0026). */}
                              {isPlatformAdmin && u.id !== profile?.id && (
                                <Button size="sm" variant="danger" onClick={() => openDelete(u)} title={t('users.deleteHint')}>
                                  <Trash2 size={14} />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )
          )}
        </>
      )}

      {/* ── Invite new user modal ─────────────────────────────────────────── */}
      <Modal open={inviteModal} onClose={() => setInviteModal(false)} title={t('users.inviteTitle')} size="md">
        <div className="space-y-4">
          <p className="text-sm text-slate-500">{t('users.inviteSubtitle')}</p>

          <Input
            label={t('users.inviteFullName')}
            value={inviteFullName}
            onChange={e => setInviteFullName(e.target.value)}
            placeholder="Ahmad Al-Hassan"
          />
          <Input
            label={t('users.inviteEmail')}
            type="email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            placeholder="ahmad@example.com"
          />
          <Input
            label={t('users.invitePhone')}
            type="tel"
            value={invitePhone}
            onChange={e => setInvitePhone(e.target.value)}
            placeholder="+961 70 000 000"
          />

          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{t('users.inviteRoleSection')}</p>

            {/* Scope type selector — org admins can only invite to buildings, not org-level */}
            <div className="flex gap-1 mb-3">
              {(['none', 'building', ...(isSuperAdmin ? ['org'] : [])] as InviteScopeType[]).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setInviteScopeType(s);
                    setInviteGrantRole(s === 'org' ? 'org_admin' : 'building_admin');
                  }}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition cursor-pointer ${inviteScopeType === s ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
                >
                  {t(`users.inviteScope.${s}`)}
                </button>
              ))}
            </div>

            {inviteScopeType === 'building' && (
              <div className="space-y-3">
                <Select
                  label={t('users.inviteBuilding')}
                  value={inviteBuildingId}
                  onChange={e => setInviteBuildingId(e.target.value)}
                >
                  <option value="">{t('common.selectBuilding')}</option>
                  {buildings.map(b => <option key={b.id} value={b.id}>{b.name} ({b.city})</option>)}
                </Select>
                <Select
                  label={t('users.role')}
                  value={inviteGrantRole}
                  onChange={e => setInviteGrantRole(e.target.value as GrantRole)}
                >
                  {BUILDING_ROLES.map(r => <option key={r} value={r}>{t(`users.roles.${r}`)}</option>)}
                </Select>
              </div>
            )}

            {inviteScopeType === 'org' && (
              <div className="space-y-3">
                <Select
                  label={t('users.inviteOrg')}
                  value={inviteOrgId}
                  onChange={e => setInviteOrgId(e.target.value)}
                >
                  <option value="">{t('users.selectOrgHint')}</option>
                  {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
                <Select
                  label={t('users.role')}
                  value={inviteGrantRole}
                  onChange={e => setInviteGrantRole(e.target.value as GrantRole)}
                >
                  {rolesForInviteScope.map(r => <option key={r} value={r}>{t(`users.roles.${r}`)}</option>)}
                </Select>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setInviteModal(false)}>{t('common.cancel')}</Button>
            <Button
              onClick={sendInvite}
              loading={inviteLoading}
              disabled={!inviteEmail.trim() || !inviteFullName.trim()}
            >
              <Mail size={15} /> {t('users.sendInvite')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Grant building access modal ───────────────────────────────────── */}
      {/* Deactivate confirmation. The DB (0026) is what actually enforces the rules —
          if it refuses (last admin, above your level, …) the error surfaces as a toast. */}
      <Modal open={!!deactivateTarget} onClose={() => setDeactivateTarget(null)} title={t('users.deactivate')} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            {t('users.deactivateExplain', { name: deactivateTarget?.full_name ?? '' })}
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">{t('users.deactivateReasonLabel')}</label>
            <textarea
              value={deactivateReason}
              onChange={(e) => setDeactivateReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder={t('users.deactivateReasonPlaceholder')}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#57D6E2]/40 resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setDeactivateTarget(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={deactivating} onClick={confirmDeactivate}>{t('users.deactivate')}</Button>
          </div>
        </div>
      </Modal>

      {/* Hard delete. can_delete_user() tells us WHY it's blocked; the DB re-checks
          on delete_user() regardless, so this is explanation, not enforcement. */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={t('users.deleteTitle')} size="sm">
        <div className="space-y-4">
          {deleteBlockers === null ? (
            <p className="text-sm text-slate-500">{t('common.loading')}</p>
          ) : deleteBlockers.length > 0 ? (
            <>
              <p className="text-sm font-medium text-rose-400">{t('users.cannotDelete')}</p>
              <ul className="space-y-1.5">
                {deleteBlockers.map((b, i) => (
                  <li key={i} className="text-sm text-slate-300 flex gap-2">
                    <span className="text-rose-400">•</span><span>{b}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-500">{t('users.deactivateInstead')}</p>
              <div className="flex justify-end pt-1">
                <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t('common.close')}</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-500">
                {t('users.deleteConfirm', { name: deleteTarget?.full_name ?? '' })}
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
                <Button variant="danger" loading={deleting} onClick={confirmDelete}>{t('users.deleteTitle')}</Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal open={grantModal} onClose={() => setGrantModal(false)} title={t('users.addAccess')} size="sm">
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">{t('users.name')}</label>
            <input
              type="text"
              placeholder={t('common.search')}
              value={grantSearch}
              onChange={e => { setGrantSearch(e.target.value); setGrantUserId(''); }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {grantSearch.length > 0 && (
              <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-50">
                {availableProfiles.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-3">{t('users.noUsers')}</p>
                ) : availableProfiles.slice(0, 20).map(p => (
                  <button
                    key={p.id} type="button"
                    onClick={() => { setGrantUserId(p.id); setGrantSearch(p.full_name); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition cursor-pointer text-start ${grantUserId === p.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'}`}
                  >
                    <span className="font-medium">{p.full_name}</span>
                    {p.apartment_number && <span className="text-slate-400 text-xs">· Apt {p.apartment_number}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Select label={t('users.role')} value={grantRole} onChange={e => setGrantRole(e.target.value as GrantRole)}>
            {BUILDING_ROLES.map(r => <option key={r} value={r}>{t(`users.roles.${r}`, { defaultValue: r })}</option>)}
          </Select>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setGrantModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={addGrant} disabled={!grantUserId}>{t('users.addAccess')}</Button>
          </div>
        </div>
      </Modal>

      {/* ── Grant org access modal ────────────────────────────────────────── */}
      <Modal open={orgGrantModal} onClose={() => setOrgGrantModal(false)} title={t('users.addOrgAccess')} size="sm">
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">{t('users.name')}</label>
            <input
              type="text"
              placeholder={t('common.search')}
              value={orgGrantSearch}
              onChange={e => { setOrgGrantSearch(e.target.value); setOrgGrantUserId(''); }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            {orgGrantSearch.length > 0 && (
              <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-50">
                {availableProfilesForOrg.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-3">{t('users.noUsers')}</p>
                ) : availableProfilesForOrg.slice(0, 20).map(p => (
                  <button
                    key={p.id} type="button"
                    onClick={() => { setOrgGrantUserId(p.id); setOrgGrantSearch(p.full_name); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition cursor-pointer text-start ${orgGrantUserId === p.id ? 'bg-violet-50 text-violet-700' : 'text-slate-700 hover:bg-slate-50'}`}
                  >
                    <span className="font-medium">{p.full_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Select label={t('users.role')} value={orgGrantRole} onChange={e => setOrgGrantRole(e.target.value as GrantRole)}>
            {ORG_ROLES.map(r => <option key={r} value={r}>{t(`users.roles.${r}`, { defaultValue: r })}</option>)}
          </Select>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOrgGrantModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={addOrgGrant} disabled={!orgGrantUserId}>{t('users.addOrgAccess')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
