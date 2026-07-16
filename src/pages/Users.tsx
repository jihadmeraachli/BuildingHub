import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Boxes, Mail, Network, Shield, Trash2, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useEntities } from '@/lib/entities';
import type { Profile, UserStatus, Building, Grant, GrantRole, Organization } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { SelectField, SelectItem } from '@/components/ui/Select';
import { SkeletonTable } from '@/components/ui/Skeleton';

type Tab = 'all' | 'pending' | 'access';
// Hierarchy: org > compound > building (migration 0027).
type GrantScope = 'building' | 'compound' | 'org';
type InviteScopeType = 'none' | 'building' | 'compound' | 'org';

type GrantRow = Grant & {
  profiles: { id: string; full_name: string; apartment_number: string | null } | null;
};

// A compound grant covers every block in the compound, incl. future ones (0027).
const BUILDING_ROLES: GrantRole[] = ['building_admin', 'building_super', 'building_finance', 'viewer'];
const COMPOUND_ROLES: GrantRole[] = ['compound_admin', 'compound_finance', 'viewer'];
const ORG_ROLES: GrantRole[] = ['org_admin', 'org_finance'];

// NB: there is deliberately no legacy profiles.role colour map any more — the
// Role column now reflects `grants` (what RLS actually enforces).
const statusColor: Record<UserStatus, 'green' | 'yellow' | 'red' | 'slate'> = {
  active: 'green', pending: 'yellow', rejected: 'red', inactive: 'slate',
};
const grantRoleColor: Record<string, 'blue' | 'orange' | 'slate' | 'teal'> = {
  building_admin: 'blue', org_admin: 'blue', compound_admin: 'blue',
  building_finance: 'orange', org_finance: 'orange', compound_finance: 'orange',
  building_super: 'teal', viewer: 'slate',
};

export default function Users() {
  const { t } = useTranslation();
  const { profile, isPlatformAdmin, can, canAny, grants: authGrants } = useAuth();
  const isSuperAdmin = isPlatformAdmin;
  const isOrgAdmin = !isPlatformAdmin && authGrants.some(g => g.scope_type === 'org' && g.role === 'org_admin');
  const myOrgIds = authGrants.filter(g => g.scope_type === 'org' && g.role === 'org_admin').map(g => g.org_id as string).filter(Boolean);
  const showBuildingSelector = isSuperAdmin || isOrgAdmin;

  const [users, setUsers] = useState<Profile[]>([]);
  /** userId -> grant roles covering the selected blocks (the REAL access). */
  const [accessRoles, setAccessRoles] = useState<Record<string, GrantRole[]>>({});
  const [buildings, setBuildings] = useState<Building[]>([]);
  const entities = useEntities(buildings); // compounds (grouping blocks) + standalone buildings
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [entityKey, setEntityKey] = useState<string>('');
  const [blockFilter, setBlockFilter] = useState<string>('');
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const [grantScope, setGrantScope] = useState<GrantScope>('building');
  // compound scope (0027) — one grant covers every block, incl. blocks added later
  const [selectedCompoundId, setSelectedCompoundId] = useState('');
  const [compoundGrants, setCompoundGrants] = useState<GrantRow[]>([]);
  const [compoundGrantLoading, setCompoundGrantLoading] = useState(false);
  const [compoundGrantModal, setCompoundGrantModal] = useState(false);
  const [compoundGrantUserId, setCompoundGrantUserId] = useState('');
  const [compoundGrantRole, setCompoundGrantRole] = useState<GrantRole>('compound_admin');
  const [compoundGrantSearch, setCompoundGrantSearch] = useState('');
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
  const [inviteCompoundId, setInviteCompoundId] = useState('');
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

  // ---- compound-first scoping (matches Dashboard/Finance/Dues via useEntities) ----
  // People used to be pinned to ONE block. An entity is a compound (grouping its
  // blocks) or a standalone building; the list spans the whole entity unless a
  // block filter is set.
  const selEntity = entities.find(e => e.key === entityKey) ?? null;
  const compoundEntities = entities.filter(e => e.kind === 'compound');

  useEffect(() => { setBlockFilter(''); }, [entityKey]);
  useEffect(() => { if (!entityKey && entities.length) setEntityKey(entities[0].key); }, [entities, entityKey]);

  // Which blocks the people list covers.
  const listBuildingIds = useMemo<string[]>(() => {
    if (!showBuildingSelector) return profile?.building_id ? [profile.building_id] : [];
    if (blockFilter) return [blockFilter];
    return selEntity?.buildingIds ?? [];
  }, [showBuildingSelector, profile?.building_id, blockFilter, selEntity]);
  const listKey = listBuildingIds.join(',');

  // Block-scoped actions (grants on a single block) still need ONE building:
  // the filtered block, or the entity's only block if it has just one.
  const activeBuildingId = showBuildingSelector
    ? (blockFilter || (selEntity?.blocks.length === 1 ? selEntity.blocks[0].id : ''))
    : profile?.building_id ?? '';

  const canManageAccess = isPlatformAdmin
    || (listBuildingIds.length ? listBuildingIds.some(id => can('grant.manage', id)) : canAny('grant.manage'));

  useEffect(() => {
    if (listBuildingIds.length && tab !== 'access') loadUsers();
  }, [listKey, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeBuildingId && tab === 'access' && grantScope === 'building') loadGrants();
  }, [activeBuildingId, tab, grantScope]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedOrgId && tab === 'access' && grantScope === 'org') loadOrgGrants();
  }, [selectedOrgId, tab, grantScope]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedCompoundId && tab === 'access' && grantScope === 'compound') loadCompoundGrants();
  }, [selectedCompoundId, tab, grantScope]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadUsers() {
    if (!listBuildingIds.length) { setUsers([]); return; }
    setLoading(true);
    // spans every block of the selected compound (or just the filtered block)
    let q = supabase.from('profiles').select('*').in('building_id', listBuildingIds);
    if (tab === 'pending') q = q.eq('status', 'pending');
    q = q.order('created_at', { ascending: false });
    const { data } = await q;
    setUsers(data ?? []);
    setLoading(false);

    // Effective management access for these blocks, resolved from `grants` —
    // the same source user_can() enforces. Covers building, compound (0027) and
    // org scopes, so the badge matches reality instead of legacy profiles.role.
    const compoundIdSet = new Set(
      buildings.filter(b => listBuildingIds.includes(b.id)).map(b => b.compound_id).filter(Boolean) as string[],
    );
    const { data: obRows } = await supabase
      .from('org_buildings').select('org_id, building_id').in('building_id', listBuildingIds);
    const orgIdSet = new Set(((obRows as { org_id: string }[]) ?? []).map(r => r.org_id));
    const { data: gRows } = await supabase
      .from('grants').select('user_id, role, scope_type, building_id, compound_id, org_id');
    const roleMap: Record<string, GrantRole[]> = {};
    for (const g of (gRows as Grant[]) ?? []) {
      const covers =
        (g.scope_type === 'building' && !!g.building_id && listBuildingIds.includes(g.building_id))
        || (g.scope_type === 'compound' && !!g.compound_id && compoundIdSet.has(g.compound_id))
        || (g.scope_type === 'org' && !!g.org_id && orgIdSet.has(g.org_id));
      if (covers) (roleMap[g.user_id] ??= []).push(g.role);
    }
    setAccessRoles(roleMap);

    const { data: us } = await supabase.from('units').select('id, label').in('building_id', listBuildingIds);
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

  async function loadCompoundGrants() {
    if (!selectedCompoundId) return;
    setCompoundGrantLoading(true);
    const { data } = await supabase
      .from('grants').select('*, profiles(id, full_name, apartment_number)')
      .eq('compound_id', selectedCompoundId).eq('scope_type', 'compound').order('created_at');
    setCompoundGrants((data as GrantRow[]) ?? []);
    setCompoundGrantLoading(false);
  }

  async function openCompoundGrantModal() {
    const { data } = await supabase.from('profiles').select('*').eq('status', 'active').order('full_name');
    setAllProfiles(data ?? []);
    setCompoundGrantUserId(''); setCompoundGrantRole('compound_admin'); setCompoundGrantSearch('');
    setCompoundGrantModal(true);
  }

  async function addCompoundGrant() {
    if (!compoundGrantUserId || !selectedCompoundId) return;
    const { error } = await supabase.from('grants').insert({
      user_id: compoundGrantUserId, scope_type: 'compound',
      compound_id: selectedCompoundId, building_id: null, org_id: null, role: compoundGrantRole,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.grantAdded'));
    setCompoundGrantModal(false); loadCompoundGrants();
  }

  async function removeCompoundGrant(id: string) {
    const { error } = await supabase.from('grants').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.grantRemoved')); loadCompoundGrants();
  }

  /**
   * Change an existing grant's role in place — no revoke-then-re-add.
   * The DB re-checks it: grants_hierarchy_guard_trg fires BEFORE UPDATE too, so
   * you still can't promote anyone to at/above your own level (0027).
   */
  async function updateGrantRole(id: string, role: GrantRole, reload: () => void) {
    const { error } = await supabase.from('grants').update({ role }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.roleUpdated'));
    reload();
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
    setInviteBuildingId(''); setInviteOrgId(''); setInviteCompoundId('');
    setInviteModal(true);
  }

  async function sendInvite() {
    if (!inviteEmail.trim() || !inviteFullName.trim()) return;
    setInviteLoading(true);

    const grant =
      inviteScopeType === 'building' && inviteBuildingId
        ? { role: inviteGrantRole, building_id: inviteBuildingId, org_id: null }
        : inviteScopeType === 'compound' && inviteCompoundId
        ? { role: inviteGrantRole, compound_id: inviteCompoundId, building_id: null, org_id: null }
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

  // When the list spans several blocks, show which block each person belongs to —
  // otherwise the rows are ambiguous in a compound view.
  const showBlockColumn = listBuildingIds.length > 1;
  const blockName = useMemo(
    () => Object.fromEntries(buildings.map(b => [b.id, b.name])) as Record<string, string>,
    [buildings],
  );

  const compoundGrantedUserIds = new Set(compoundGrants.map(g => g.user_id));
  const availableProfilesForCompound = allProfiles
    .filter(p => !compoundGrantedUserIds.has(p.id))
    .filter(p => p.full_name.toLowerCase().includes(compoundGrantSearch.toLowerCase()) || (p.apartment_number ?? '').toLowerCase().includes(compoundGrantSearch.toLowerCase()));

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'all', label: t('users.allUsers'), show: true },
    { key: 'pending', label: t('users.pendingApprovals'), show: true },
    { key: 'access', label: t('users.accessTab'), show: canManageAccess },
  ];

  const onOrgScope = tab === 'access' && grantScope === 'org' && isSuperAdmin;
  const showContent = listBuildingIds.length > 0 || isSuperAdmin;

  const rolesForInviteScope = inviteScopeType === 'org' ? ORG_ROLES : inviteScopeType === 'compound' ? COMPOUND_ROLES : BUILDING_ROLES;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <h1 className="text-xl font-semibold text-foreground">{t('users.title')}</h1>
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

      {/* Compound-first: pick the compound (or standalone building), then optionally
          narrow to one block. Same selector shape as Dashboard/Finance/Dues. */}
      {showBuildingSelector && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <select
            value={entityKey}
            onChange={e => setEntityKey(e.target.value)}
            className="rounded-lg border border-border px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 min-w-[240px]"
          >
            {entities.length === 0 && <option value="">{t('common.selectBuilding')}</option>}
            {entities.map(e => (
              <option key={e.key} value={e.key}>
                {e.kind === 'compound' ? `▣ ${e.name}` : e.name}
              </option>
            ))}
          </select>

          {selEntity?.kind === 'compound' && selEntity.blocks.length > 1 && (
            <select
              value={blockFilter}
              onChange={e => setBlockFilter(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
            >
              <option value="">{t('finance.allBlocks')}</option>
              {selEntity.blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}

          {selEntity?.kind === 'compound' && !blockFilter && selEntity.blocks.length > 1 && (
            <span className="text-xs text-muted-foreground">
              {t('users.acrossBlocks', { count: selEntity.blocks.length })}
            </span>
          )}
        </div>
      )}

      {!showContent ? (
        <Card><CardBody>
          <p className="text-sm text-muted-foreground text-center py-8">{t('users.selectBuildingHint')}</p>
        </CardBody></Card>
      ) : (
        <>
          <div className="flex gap-2 mb-4">
            {tabs.filter(t3 => t3.show).map(t3 => (
              <button
                key={t3.key}
                onClick={() => setTab(t3.key)}
                className={`text-sm px-4 py-1.5 rounded-lg border transition cursor-pointer ${tab === t3.key ? 'bg-primary border-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
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
              {/* Scope ladder, top-down: org → compound → block. Access granted higher
                  up cascades down (a compound grant covers every block in it). */}
              {(isSuperAdmin || (isOrgAdmin && compoundEntities.length > 0)) && (
                <div className="flex gap-1 flex-wrap">
                  {isSuperAdmin && (
                    <button
                      onClick={() => setGrantScope('org')}
                      className={`text-sm px-4 py-1.5 rounded-lg border transition cursor-pointer ${grantScope === 'org' ? 'bg-violet-600 border-violet-600 text-white' : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
                    >
                      <span className="flex items-center gap-1.5"><Network size={13} /> {t('users.scopeOrg')}</span>
                    </button>
                  )}
                  <button
                    onClick={() => setGrantScope('compound')}
                    className={`text-sm px-4 py-1.5 rounded-lg border transition cursor-pointer ${grantScope === 'compound' ? 'bg-[#349ECD] border-[#349ECD] text-white' : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
                  >
                    <span className="flex items-center gap-1.5"><Boxes size={13} /> {t('users.scopeCompound')}</span>
                  </button>
                  <button
                    onClick={() => setGrantScope('building')}
                    className={`text-sm px-4 py-1.5 rounded-lg border transition cursor-pointer ${grantScope === 'building' ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
                  >
                    {t('users.scopeBuilding')}
                  </button>
                </div>
              )}
              {/* org admins without compounds stay on building scope only — no org-level grant management */}

              {grantScope === 'compound' && (isSuperAdmin || isOrgAdmin) ? (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={selectedCompoundId}
                      onChange={e => setSelectedCompoundId(e.target.value)}
                      className="rounded-lg border border-border px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 min-w-[280px]"
                    >
                      <option value="">{t('users.selectCompoundHint')}</option>
                      {compoundEntities.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.blocks.length} {t('buildings.blocks')})
                        </option>
                      ))}
                    </select>
                    {selectedCompoundId && (
                      <Button size="sm" onClick={openCompoundGrantModal}><Shield size={14} /> {t('users.addAccess')}</Button>
                    )}
                  </div>

                  {selectedCompoundId && (
                    <p className="text-xs text-muted-foreground">{t('users.compoundScopeNote')}</p>
                  )}

                  {!selectedCompoundId ? (
                    <Card><CardBody>
                      <div className="text-center py-10">
                        <Boxes size={32} className="mx-auto text-primary mb-2" />
                        <p className="text-sm text-muted-foreground">{t('users.selectCompoundHint')}</p>
                      </div>
                    </CardBody></Card>
                  ) : compoundGrantLoading ? (
                    <SkeletonTable rows={3} cols={3} />
                  ) : compoundGrants.length === 0 ? (
                    <Card><CardBody>
                      <div className="text-center py-10">
                        <Shield size={32} className="mx-auto text-primary mb-2" />
                        <p className="text-sm text-muted-foreground">{t('users.noCompoundGrants')}</p>
                      </div>
                    </CardBody></Card>
                  ) : (
                    <Card>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                              <th className="px-4 py-3 text-start font-medium">{t('users.name')}</th>
                              <th className="px-4 py-3 text-start font-medium">{t('users.role')}</th>
                              <th className="px-4 py-3 text-start font-medium">{t('common.actions')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {compoundGrants.map(g => (
                              <tr key={g.id} className="hover:bg-accent/30">
                                <td className="px-4 py-3">
                                  <p className="font-medium text-foreground">{g.profiles?.full_name ?? '—'}</p>
                                </td>
                                <td className="px-4 py-3">
                                  <select
                                    value={g.role}
                                    onChange={e => updateGrantRole(g.id, e.target.value as GrantRole, loadCompoundGrants)}
                                    className="rounded-lg border border-border bg-background text-foreground px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring/50 cursor-pointer"
                                  >
                                    {COMPOUND_ROLES.map(r => (
                                      <option key={r} value={r}>{t(`users.roles.${r}`, { defaultValue: r })}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-4 py-3">
                                  <button onClick={() => removeCompoundGrant(g.id)} className="text-muted-foreground hover:text-rose-400 transition cursor-pointer" title={t('users.revokeAccess')}>
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
              ) : grantScope === 'org' && isSuperAdmin ? (
                <>
                  <select
                    value={selectedOrgId}
                    onChange={e => setSelectedOrgId(e.target.value)}
                    className="rounded-lg border border-border px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 min-w-[280px]"
                  >
                    <option value="">{t('users.selectOrgHint')}</option>
                    {organizations.map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>

                  {!selectedOrgId ? (
                    <Card><CardBody>
                      <div className="text-center py-10">
                        <Network size={32} className="mx-auto text-primary mb-2" />
                        <p className="text-sm text-muted-foreground">{t('users.selectOrgHint')}</p>
                      </div>
                    </CardBody></Card>
                  ) : orgGrantLoading ? (
                    <SkeletonTable rows={3} cols={3} />
                  ) : orgGrants.length === 0 ? (
                    <Card><CardBody>
                      <div className="text-center py-10">
                        <Shield size={32} className="mx-auto text-primary mb-2" />
                        <p className="text-sm text-muted-foreground">{t('users.noOrgGrants')}</p>
                      </div>
                    </CardBody></Card>
                  ) : (
                    <Card>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                              <th className="px-4 py-3 text-start font-medium">{t('users.name')}</th>
                              <th className="px-4 py-3 text-start font-medium">{t('users.role')}</th>
                              <th className="px-4 py-3 text-start font-medium">{t('common.actions')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {orgGrants.map(g => (
                              <tr key={g.id} className="hover:bg-accent/30">
                                <td className="px-4 py-3">
                                  <p className="font-medium text-foreground">{g.profiles?.full_name ?? '—'}</p>
                                </td>
                                <td className="px-4 py-3">
                                  <select
                                    value={g.role}
                                    onChange={e => updateGrantRole(g.id, e.target.value as GrantRole, loadOrgGrants)}
                                    className="rounded-lg border border-border bg-background text-foreground px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring/50 cursor-pointer"
                                  >
                                    {ORG_ROLES.map(r => (
                                      <option key={r} value={r}>{t(`users.roles.${r}`, { defaultValue: r })}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-4 py-3">
                                  <button onClick={() => removeOrgGrant(g.id)} className="text-muted-foreground hover:text-red-500 transition cursor-pointer" title={t('users.revokeAccess')}>
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
                    <p className="text-sm text-muted-foreground text-center py-8">{t('users.selectBuildingHint')}</p>
                  </CardBody></Card>
                ) : grantLoading ? (
                  <SkeletonTable rows={4} cols={3} />
                ) : grants.length === 0 ? (
                  <Card><CardBody>
                    <div className="text-center py-10">
                      <Shield size={32} className="mx-auto text-primary mb-2" />
                      <p className="text-sm text-muted-foreground">{t('users.noGrants')}</p>
                    </div>
                  </CardBody></Card>
                ) : (
                  <Card>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                            <th className="px-4 py-3 text-start font-medium">{t('users.name')}</th>
                            <th className="px-4 py-3 text-start font-medium">{t('users.role')}</th>
                            <th className="px-4 py-3 text-start font-medium">{t('common.actions')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {grants.map(g => (
                            <tr key={g.id} className="hover:bg-accent/30">
                              <td className="px-4 py-3">
                                <p className="font-medium text-foreground">{g.profiles?.full_name ?? '—'}</p>
                                {g.profiles?.apartment_number && (
                                  <p className="text-xs text-muted-foreground">Apt {g.profiles.apartment_number}</p>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <select
                                  value={g.role}
                                  onChange={e => updateGrantRole(g.id, e.target.value as GrantRole, loadGrants)}
                                  className="rounded-lg border border-border bg-background text-foreground px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring/50 cursor-pointer"
                                >
                                  {BUILDING_ROLES.map(r => (
                                    <option key={r} value={r}>{t(`users.roles.${r}`, { defaultValue: r })}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-4 py-3">
                                <button onClick={() => removeGrant(g.id)} className="text-muted-foreground hover:text-red-500 transition cursor-pointer" title={t('users.revokeAccess')}>
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
              <Card><CardBody><p className="text-sm text-muted-foreground text-center py-8">{t('users.selectBuildingHint')}</p></CardBody></Card>
            ) : loading ? (
              <SkeletonTable rows={5} cols={6} />
            ) : users.length === 0 ? (
              <Card><CardBody><p className="text-sm text-muted-foreground text-center py-8">{t('users.noUsers')}</p></CardBody></Card>
            ) : (
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                        <th className="px-4 py-3 text-start font-medium">{t('users.name')}</th>
                        {showBlockColumn && <th className="px-4 py-3 text-start font-medium">{t('users.block')}</th>}
                        <th className="px-4 py-3 text-start font-medium">{t('users.apartment')}</th>
                        <th className="px-4 py-3 text-start font-medium">{t('users.role')}</th>
                        <th className="px-4 py-3 text-start font-medium">{t('users.status')}</th>
                        <th className="px-4 py-3 text-start font-medium">{t('users.notifications')}</th>
                        <th className="px-4 py-3 text-start font-medium">{t('common.actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {users.map(u => (
                        <tr key={u.id} className="hover:bg-accent/30">
                          <td className="px-4 py-3">
                            <p className="font-medium text-foreground">{u.full_name}</p>
                            <p className="text-xs text-muted-foreground">{u.phone ?? '—'}</p>
                          </td>
                          {showBlockColumn && (
                            <td className="px-4 py-3">
                              <span className="text-xs text-muted-foreground">{blockName[u.building_id ?? ''] ?? '—'}</span>
                            </td>
                          )}
                          <td className="px-4 py-3">
                            {assigned[u.id]?.length ? (
                              <div className="flex flex-wrap gap-1">
                                {assigned[u.id].map((m) => (
                                  <span key={m.label} className={`text-xs rounded-full px-2 py-0.5 ${m.tenure === 'tenant' ? 'bg-amber-50 text-amber-700' : 'bg-primary/10 text-primary'}`}>{m.label}</span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">{u.apartment_number ?? '—'}</span>
                            )}
                          </td>
                          {/* EFFECTIVE access, read from `grants` — the same source RLS
                              enforces. The old control here wrote the dead legacy
                              profiles.role field, which granted nothing. */}
                          <td className="px-4 py-3">
                            {u.is_platform_admin ? (
                              <Badge color="blue">{t('users.roles.platform_admin')}</Badge>
                            ) : accessRoles[u.id]?.length ? (
                              <div className="flex flex-wrap gap-1">
                                {accessRoles[u.id].map((r, i) => (
                                  <Badge key={i} color={grantRoleColor[r] ?? 'slate'}>
                                    {t(`users.roles.${r}`, { defaultValue: r })}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">{t('users.roles.resident')}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge color={statusColor[u.status]}>{t(`users.statuses.${u.status}`)}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                                <input type="checkbox" checked={u.notify_email} onChange={e => updateUser(u.id, { notify_email: e.target.checked })} className="rounded accent-primary" />
                                {t('users.notifyEmail')}
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                                <input type="checkbox" checked={u.notify_whatsapp} onChange={e => updateUser(u.id, { notify_whatsapp: e.target.checked })} className="rounded accent-primary" />
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
          <p className="text-sm text-muted-foreground">{t('users.inviteSubtitle')}</p>

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

          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t('users.inviteRoleSection')}</p>

            {/* Scope type selector — org admins can invite to buildings/compounds, not org-level */}
            <div className="flex gap-1 flex-wrap mb-3">
              {(
                ['none', 'building',
                  ...((isSuperAdmin || (isOrgAdmin && compoundEntities.length > 0)) ? ['compound'] : []),
                  ...(isSuperAdmin ? ['org'] : []),
                ] as InviteScopeType[]
              ).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setInviteScopeType(s);
                    setInviteGrantRole(s === 'org' ? 'org_admin' : s === 'compound' ? 'compound_admin' : 'building_admin');
                  }}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition cursor-pointer ${inviteScopeType === s ? 'bg-primary border-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
                >
                  {t(`users.inviteScope.${s}`)}
                </button>
              ))}
            </div>

            {inviteScopeType === 'building' && (
              <div className="space-y-3">
                <SelectField
                  label={t('users.inviteBuilding')}
                  value={inviteBuildingId || '__none__'}
                  onValueChange={v => setInviteBuildingId(v === '__none__' ? '' : v)}
                >
                  <SelectItem value="__none__">{t('common.selectBuilding')}</SelectItem>
                  {buildings.map(b => <SelectItem key={b.id} value={b.id}>{b.name} ({b.city})</SelectItem>)}
                </SelectField>
                <SelectField
                  label={t('users.role')}
                  value={inviteGrantRole}
                  onValueChange={v => setInviteGrantRole(v as GrantRole)}
                >
                  {BUILDING_ROLES.map(r => <SelectItem key={r} value={r}>{t(`users.roles.${r}`)}</SelectItem>)}
                </SelectField>
              </div>
            )}

            {inviteScopeType === 'compound' && (
              <div className="space-y-3">
                <SelectField
                  label={t('users.selectCompoundHint')}
                  value={inviteCompoundId || '__none__'}
                  onValueChange={v => setInviteCompoundId(v === '__none__' ? '' : v)}
                >
                  <SelectItem value="__none__">{t('users.selectCompoundHint')}</SelectItem>
                  {compoundEntities.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.blocks.length} {t('buildings.blocks')})</SelectItem>)}
                </SelectField>
                <SelectField
                  label={t('users.role')}
                  value={inviteGrantRole}
                  onValueChange={v => setInviteGrantRole(v as GrantRole)}
                >
                  {COMPOUND_ROLES.map(r => <SelectItem key={r} value={r}>{t(`users.roles.${r}`)}</SelectItem>)}
                </SelectField>
              </div>
            )}

            {inviteScopeType === 'org' && (
              <div className="space-y-3">
                <SelectField
                  label={t('users.inviteOrg')}
                  value={inviteOrgId || '__none__'}
                  onValueChange={v => setInviteOrgId(v === '__none__' ? '' : v)}
                >
                  <SelectItem value="__none__">{t('users.selectOrgHint')}</SelectItem>
                  {organizations.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectField>
                <SelectField
                  label={t('users.role')}
                  value={inviteGrantRole}
                  onValueChange={v => setInviteGrantRole(v as GrantRole)}
                >
                  {rolesForInviteScope.map(r => <SelectItem key={r} value={r}>{t(`users.roles.${r}`)}</SelectItem>)}
                </SelectField>
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
          <p className="text-sm text-muted-foreground">
            {t('users.deactivateExplain', { name: deactivateTarget?.full_name ?? '' })}
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">{t('users.deactivateReasonLabel')}</label>
            <textarea
              value={deactivateReason}
              onChange={(e) => setDeactivateReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder={t('users.deactivateReasonPlaceholder')}
              className="rounded-xl border border-border bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 resize-none"
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
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : deleteBlockers.length > 0 ? (
            <>
              <p className="text-sm font-medium text-rose-400">{t('users.cannotDelete')}</p>
              <ul className="space-y-1.5">
                {deleteBlockers.map((b, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex gap-2">
                    <span className="text-rose-400">•</span><span>{b}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{t('users.deactivateInstead')}</p>
              <div className="flex justify-end pt-1">
                <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{t('common.close')}</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
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
            <label className="text-sm font-medium text-muted-foreground">{t('users.name')}</label>
            <input
              type="text"
              placeholder={t('common.search')}
              value={grantSearch}
              onChange={e => { setGrantSearch(e.target.value); setGrantUserId(''); }}
              className="rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
            />
            {grantSearch.length > 0 && (
              <div className="max-h-44 overflow-y-auto border border-border rounded-xl divide-y divide-border">
                {availableProfiles.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">{t('users.noUsers')}</p>
                ) : availableProfiles.slice(0, 20).map(p => (
                  <button
                    key={p.id} type="button"
                    onClick={() => { setGrantUserId(p.id); setGrantSearch(p.full_name); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition cursor-pointer text-start ${grantUserId === p.id ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent'}`}
                  >
                    <span className="font-medium">{p.full_name}</span>
                    {p.apartment_number && <span className="text-muted-foreground text-xs">· Apt {p.apartment_number}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <SelectField label={t('users.role')} value={grantRole} onValueChange={v => setGrantRole(v as GrantRole)}>
            {BUILDING_ROLES.map(r => <SelectItem key={r} value={r}>{t(`users.roles.${r}`, { defaultValue: r })}</SelectItem>)}
          </SelectField>
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
            <label className="text-sm font-medium text-muted-foreground">{t('users.name')}</label>
            <input
              type="text"
              placeholder={t('common.search')}
              value={orgGrantSearch}
              onChange={e => { setOrgGrantSearch(e.target.value); setOrgGrantUserId(''); }}
              className="rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
            />
            {orgGrantSearch.length > 0 && (
              <div className="max-h-44 overflow-y-auto border border-border rounded-xl divide-y divide-border">
                {availableProfilesForOrg.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">{t('users.noUsers')}</p>
                ) : availableProfilesForOrg.slice(0, 20).map(p => (
                  <button
                    key={p.id} type="button"
                    onClick={() => { setOrgGrantUserId(p.id); setOrgGrantSearch(p.full_name); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition cursor-pointer text-start ${orgGrantUserId === p.id ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent'}`}
                  >
                    <span className="font-medium">{p.full_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <SelectField label={t('users.role')} value={orgGrantRole} onValueChange={v => setOrgGrantRole(v as GrantRole)}>
            {ORG_ROLES.map(r => <SelectItem key={r} value={r}>{t(`users.roles.${r}`, { defaultValue: r })}</SelectItem>)}
          </SelectField>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOrgGrantModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={addOrgGrant} disabled={!orgGrantUserId}>{t('users.addOrgAccess')}</Button>
          </div>
        </div>
      </Modal>

      {/* Compound access — one grant, every block (0027) */}
      <Modal open={compoundGrantModal} onClose={() => setCompoundGrantModal(false)} title={t('users.addCompoundAccess')} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('users.compoundScopeNote')}</p>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">{t('users.name')}</label>
            <input
              type="text"
              placeholder={t('common.search')}
              value={compoundGrantSearch}
              onChange={e => { setCompoundGrantSearch(e.target.value); setCompoundGrantUserId(''); }}
              className="rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
            />
            {compoundGrantSearch.length > 0 && (
              <div className="max-h-44 overflow-y-auto border border-border rounded-xl divide-y divide-border">
                {availableProfilesForCompound.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">{t('users.noUsers')}</p>
                ) : availableProfilesForCompound.slice(0, 20).map(p => (
                  <button
                    key={p.id} type="button"
                    onClick={() => { setCompoundGrantUserId(p.id); setCompoundGrantSearch(p.full_name); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition cursor-pointer text-start ${compoundGrantUserId === p.id ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent'}`}
                  >
                    <span className="font-medium">{p.full_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <SelectField label={t('users.role')} value={compoundGrantRole} onValueChange={v => setCompoundGrantRole(v as GrantRole)}>
            {COMPOUND_ROLES.map(r => <SelectItem key={r} value={r}>{t(`users.roles.${r}`, { defaultValue: r })}</SelectItem>)}
          </SelectField>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCompoundGrantModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={addCompoundGrant} disabled={!compoundGrantUserId}>{t('users.addCompoundAccess')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
