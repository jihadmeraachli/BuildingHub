import { useEffect, useMemo, useState } from 'react';
import { fmtDate } from '@/lib/dateFmt';
import { useTranslation } from 'react-i18next';
import { toast } from '@/lib/toast';
import { Lock, Mail, Search, Trash2, UserPlus } from 'lucide-react';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useEntities } from '@/lib/entities';
import type { Profile, UserStatus, Building, Grant, GrantRole, Organization } from '@/types';
import { grantIsLive } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { SkeletonTable } from '@/components/ui/Skeleton';

type Tab = 'all' | 'invites';
type InviteScopeType = 'none' | 'building' | 'compound' | 'org';

/** Row from admin_membership_invites() (0055) — names resolved server-side. */
interface InviteRow {
  id: string;
  unit_id: string;
  unit_label: string;
  building_id: string;
  building_name: string;
  user_id: string;
  user_name: string;
  tenure: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';
  invited_by_name: string;
  created_at: string;
  expires_at: string;
  responded_at: string | null;
}
const inviteStatusColor: Record<InviteRow['status'], 'green' | 'yellow' | 'red' | 'slate'> = {
  pending: 'yellow', accepted: 'green', declined: 'red', expired: 'slate', cancelled: 'slate',
};

// A compound grant covers every block in the compound, incl. future ones (0027).
const BUILDING_ROLES: GrantRole[] = ['building_admin', 'building_super', 'building_finance', 'building_collector', 'viewer'];
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
  const { profile, isPlatformAdmin, can, grants: authGrants, manageableBuildingIds } = useAuth();
  const isSuperAdmin = isPlatformAdmin;
  const isOrgAdmin = !isPlatformAdmin && authGrants.some(g => g.scope_type === 'org' && g.role === 'org_admin');
  const isCompoundAdmin = !isPlatformAdmin && authGrants.some(g => g.scope_type === 'compound' && g.role === 'compound_admin');
  const isBuildingAdmin = !isPlatformAdmin && authGrants.some(g => g.scope_type === 'building' && g.role === 'building_admin');
  const myOrgIds = authGrants.filter(g => g.scope_type === 'org' && g.role === 'org_admin').map(g => g.org_id as string).filter(Boolean);
  // v3: ANY manager gets the entity selector, driven by their grants — the
  // legacy profile.building_id fallback starved building/compound admins.
  const isScopeManager = !isSuperAdmin && !isOrgAdmin && manageableBuildingIds.length > 0;
  const showBuildingSelector = isSuperAdmin || isOrgAdmin || isScopeManager;

  const [users, setUsers] = useState<Profile[]>([]);
  /** userId -> grant roles covering the selected blocks (the REAL access). */
  const [accessRoles, setAccessRoles] = useState<Record<string, GrantRole[]>>({});
  const [buildings, setBuildings] = useState<Building[]>([]);
  const entities = useEntities(buildings); // compounds (grouping blocks) + standalone buildings
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  // GLOBAL entity selection (sidebar); '' = people across all managed buildings.
  const { entityKey } = useAuth();
  const [blockFilter, setBlockFilter] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const [assigned, setAssigned] = useState<Record<string, { label: string; tenure: string }[]>>({});
  /** userId -> pending unit invitations (consent flow, 0053) awaiting their answer */
  const [pendingInvites, setPendingInvites] = useState<Record<string, { id: string; label: string }[]>>({});
  /** Invitations tab: every invite in scope, any status (admin_membership_invites, 0055) */
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  // deactivate confirmation (real modal — window.prompt is blocked in sandboxed iframes)
  const [deactivateTarget, setDeactivateTarget] = useState<Profile | null>(null);
  const [deactivateReason, setDeactivateReason] = useState('');
  const [deactivating, setDeactivating] = useState(false);
  // hard delete (platform admin only) — blockers come from can_delete_user()
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deleteBlockers, setDeleteBlockers] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  // edit profile (name + phone): platform admin, or resident.manage over the
  // user's building. Email/password/2FA stay strictly self-service (Settings) —
  // email is the account identity and an admin-changeable email = takeover vector.
  const [editTarget, setEditTarget] = useState<Profile | null>(null);
  const [editForm, setEditForm] = useState({ full_name: '', phone: '' });
  const [editSaving, setEditSaving] = useState(false);
  // Read-only identity facts (email, 2FA) from admin_user_identity() (0044)
  const [editIdentity, setEditIdentity] = useState<{ email: string; mfa_enabled: boolean } | null>(null);

  // Add existing Abniyah user by email (one account, many units)
  const [addUserModal, setAddUserModal] = useState(false);
  const [addUserEmail, setAddUserEmail] = useState('');
  const [addUserFound, setAddUserFound] = useState<{ id: string; name: string } | 'notfound' | null>(null);
  const [addUserFinding, setAddUserFinding] = useState(false);
  const [addUserBuildingId, setAddUserBuildingId] = useState('');
  const [addUserUnits, setAddUserUnits] = useState<{ id: string; label: string }[]>([]);
  const [addUserUnitsLoading, setAddUserUnitsLoading] = useState(false);
  const [addUserUnitId, setAddUserUnitId] = useState('');
  const [addUserTenure, setAddUserTenure] = useState<'owner' | 'tenant'>('owner');
  const [addUserSaving, setAddUserSaving] = useState(false);

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
    } else if (isScopeManager) {
      // building/compound admins: their buildings come from grants (cascaded in AuthContext)
      supabase.from('buildings').select('*').in('id', manageableBuildingIds).order('name')
        .then(({ data }) => setBuildings(data ?? []));
    }
  }, [isSuperAdmin, isOrgAdmin, isScopeManager, manageableBuildingIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- compound-first scoping (matches Dashboard/Finance/Dues via useEntities) ----
  // People used to be pinned to ONE block. An entity is a compound (grouping its
  // blocks) or a standalone building; the list spans the whole entity unless a
  // block filter is set.
  const selEntity = entities.find(e => e.key === entityKey) ?? null;
  const compoundEntities = entities.filter(e => e.kind === 'compound');

  useEffect(() => { setBlockFilter(''); }, [entityKey]);

  // Which blocks the people list covers ('' entity = every managed building).
  const listBuildingIds = useMemo<string[]>(() => {
    if (!showBuildingSelector) return profile?.building_id ? [profile.building_id] : [];
    if (blockFilter) return [blockFilter];
    return selEntity?.buildingIds ?? entities.flatMap(e => e.buildingIds);
  }, [showBuildingSelector, profile?.building_id, blockFilter, selEntity, entities]);
  const listKey = listBuildingIds.join(',');

  useEffect(() => {
    if (!listBuildingIds.length) return;
    if (tab === 'invites') loadInvites();
    else loadUsers();
  }, [listKey, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadInvites() {
    if (!listBuildingIds.length) { setInvites([]); return; }
    setInvitesLoading(true);
    const { data, error } = await supabase.rpc('admin_membership_invites', {
      p_building_ids: listBuildingIds,
    });
    setInvitesLoading(false);
    // Tolerate the RPC missing (pre-0055 DB) — surface it instead of silent empty.
    if (error) { toast.error(error.message); setInvites([]); return; }
    setInvites((data as InviteRow[]) ?? []);
  }

  async function loadUsers() {
    if (!listBuildingIds.length) { setUsers([]); return; }
    setLoading(true);
    // People belong to the list three ways: legacy home building
    // (profiles.building_id), an active membership on a unit here (v3), or a
    // PENDING unit invitation here (0053 — they show with the amber chip
    // before accepting, so admins can track and withdraw).
    const { data: unitRows } = await supabase.from('units').select('id').in('building_id', listBuildingIds);
    const scopeUnitIds = ((unitRows ?? []) as { id: string }[]).map(u => u.id);
    let linkedUserIds: string[] = [];
    if (scopeUnitIds.length) {
      const [{ data: memberRows }, { data: inviteRows }] = await Promise.all([
        supabase.from('memberships').select('user_id').in('unit_id', scopeUnitIds).is('ended_at', null),
        supabase.from('membership_invites').select('user_id').in('unit_id', scopeUnitIds).eq('status', 'pending'),
      ]);
      linkedUserIds = [...new Set([
        ...(((memberRows ?? []) as { user_id: string }[]).map(m => m.user_id)),
        ...(((inviteRows ?? []) as { user_id: string }[]).map(i => i.user_id)),
      ])];
    }
    let q = supabase.from('profiles').select('*');
    if (linkedUserIds.length) {
      q = q.or(`building_id.in.(${listBuildingIds.join(',')}),id.in.(${linkedUserIds.join(',')})`);
    } else {
      q = q.in('building_id', listBuildingIds);
    }
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
      if (!grantIsLive(g)) continue; // expired = no access (0108)
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
      const unitIds = unitList.map((u) => u.id);
      const [{ data: ms }, { data: inv }] = await Promise.all([
        supabase.from('memberships').select('user_id, unit_id, tenure').in('unit_id', unitIds).is('ended_at', null),
        supabase.from('membership_invites').select('id, user_id, unit_id').in('unit_id', unitIds).eq('status', 'pending'),
      ]);
      const map: Record<string, { label: string; tenure: string }[]> = {};
      (ms as { user_id: string; unit_id: string; tenure: string }[] ?? []).forEach((m) => {
        (map[m.user_id] ??= []).push({ label: unitLabel[m.unit_id], tenure: m.tenure ?? 'owner' });
      });
      setAssigned(map);
      const invMap: Record<string, { id: string; label: string }[]> = {};
      ((inv as { id: string; user_id: string; unit_id: string }[]) ?? []).forEach((i) => {
        (invMap[i.user_id] ??= []).push({ id: i.id, label: unitLabel[i.unit_id] ?? '—' });
      });
      setPendingInvites(invMap);
    } else { setAssigned({}); setPendingInvites({}); }
  }

  async function withdrawInvite(inviteId: string) {
    const { error } = await supabase.from('membership_invites').delete().eq('id', inviteId);
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.inviteWithdrawn'));
    if (tab === 'invites') loadInvites(); else loadUsers();
  }

  /** Re-send an invitation: a fresh INSERT re-fires the in-app notification
   *  trigger + the email webhook and restarts the 14-day expiry. Pending or
   *  expired rows (both status='pending' in the table) are withdrawn first —
   *  the unique pending index forbids two live invites per unit × person. */
  async function resendInvite(inv: InviteRow) {
    setResendingId(inv.id);
    if (inv.status === 'pending' || inv.status === 'expired') {
      const { error } = await supabase.from('membership_invites').delete().eq('id', inv.id);
      if (error) { setResendingId(null); toast.error(error.message); return; }
    }
    const { error } = await supabase.from('membership_invites').insert({
      user_id: inv.user_id, unit_id: inv.unit_id, tenure: inv.tenure,
      invited_by: profile?.id ?? null,
    });
    setResendingId(null);
    if (error) {
      toast.error(error.code === '23505' ? t('users.addExistingInvitePending') : error.message);
      return;
    }
    toast.success(t('users.inviteResent', { name: inv.user_name }));
    loadInvites();
  }

  async function updateUser(id: string, patch: Partial<Profile>) {
    // Surface DB guard errors (0026) instead of silently claiming success.
    const { error } = await supabase.from('profiles').update(patch).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(t('common.saved'));
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

  const canEditProfile = (u: Profile) =>
    isPlatformAdmin
    || (u.building_id
      ? can('resident.manage', u.building_id)
      : listBuildingIds.some(id => can('resident.manage', id)));

  function openEdit(u: Profile) {
    setEditForm({ full_name: u.full_name, phone: u.phone ?? '' });
    setEditIdentity(null);
    setEditTarget(u);
    // Email + 2FA are display-only; tolerate the RPC missing (pre-0044 DB).
    supabase.rpc('admin_user_identity', { p_user: u.id }).then(({ data }) => {
      const r = Array.isArray(data) ? data[0] : data;
      if (r) setEditIdentity({ email: r.email, mfa_enabled: !!r.mfa_enabled });
    });
  }

  async function saveEdit() {
    if (!editTarget) return;
    setEditSaving(true);
    const { error } = await supabase.from('profiles').update({
      full_name: editForm.full_name.trim(),
      phone: editForm.phone.trim() || null,
    }).eq('id', editTarget.id);
    setEditSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.profileUpdated'));
    setEditTarget(null);
    loadUsers();
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
    setInviteBuildingId(buildings[0]?.id ?? ''); setInviteOrgId(''); setInviteCompoundId('');
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
        // Home building for the profile — required for plain residents so they
        // show up in the People list; derived from the grant for building roles.
        building_id: inviteScopeType === 'none' || inviteScopeType === 'building' ? (inviteBuildingId || null) : null,
      },
    });

    setInviteLoading(false);

    if (error) {
      // supabase-js wraps non-2xx responses in a generic FunctionsHttpError —
      // the server's actual message (e.g. "user already exists") is in context.
      let msg = t('users.inviteError');
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        try {
          const body = await ctx.json();
          if (body?.error) msg = body.error;
        } catch { /* keep fallback */ }
      }
      toast.error(msg, { duration: 8000 });
      return;
    }

    toast.success(t('users.inviteSent', { email: inviteEmail.trim() }));
    setInviteModal(false);
  }

  // ---- Add existing Abniyah user ----
  function openAddUserModal() {
    setAddUserEmail(''); setAddUserFound(null);
    setAddUserBuildingId(buildings.length === 1 ? buildings[0].id : '');
    setAddUserUnits([]); setAddUserUnitId(''); setAddUserTenure('owner');
    setAddUserModal(true);
  }

  async function findAbniyahUser() {
    if (!addUserEmail.trim()) return;
    setAddUserFinding(true);
    setAddUserFound(null);
    const { data, error } = await supabase.rpc('find_user_by_email', { p_email: addUserEmail.trim() });
    setAddUserFinding(false);
    if (error) { toast.error(error.message); return; }
    const row = Array.isArray(data) ? data[0] : data;
    setAddUserFound(row ? { id: row.user_id, name: row.full_name } : 'notfound');
  }

  /** Units for the chosen building (#65). Keyed on the modal being OPEN as well
   *  as the building, because two things broke it otherwise:
   *  1. Re-opening the modal cleared the list but re-set the same building id,
   *     so this effect never re-ran and the picker stayed empty ("no units").
   *  2. `buildings` can still be loading when the modal is opened — a
   *     single-building admin then gets no picker AND no auto-selection, so
   *     nothing ever resolves. Resolving it here covers the late arrival. */
  useEffect(() => {
    if (!addUserModal) return;
    if (!addUserBuildingId) {
      if (buildings.length === 1) setAddUserBuildingId(buildings[0].id);
      else { setAddUserUnits([]); setAddUserUnitId(''); }
      return;
    }
    let cancelled = false;
    setAddUserUnitsLoading(true);
    supabase.from('units').select('id, label').eq('building_id', addUserBuildingId).order('label')
      .then(({ data }) => {
        if (cancelled) return;
        setAddUserUnits((data as { id: string; label: string }[]) ?? []);
        setAddUserUnitsLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addUserModal, addUserBuildingId, buildings.length]);

  async function addAbniyahUser() {
    if (!addUserFound || addUserFound === 'notfound' || !addUserUnitId) return;
    setAddUserSaving(true);
    // Already an active member of this unit?
    const { data: existing } = await supabase.from('memberships')
      .select('id').eq('user_id', addUserFound.id).eq('unit_id', addUserUnitId).is('ended_at', null).limit(1);
    if (existing?.length) {
      setAddUserSaving(false);
      toast.error(t('users.addExistingAlready'));
      return;
    }
    // Consent flow (0053): this creates an INVITATION — the person is notified
    // and the membership only exists once they accept.
    const { error } = await supabase.from('membership_invites').insert({
      user_id: addUserFound.id, unit_id: addUserUnitId, tenure: addUserTenure,
      invited_by: profile?.id ?? null,
    });
    setAddUserSaving(false);
    if (error) {
      // 23505 = a pending invitation already exists for this unit × person
      toast.error(error.code === '23505' ? t('users.addExistingInvitePending') : error.message);
      return;
    }
    toast.success(t('users.addExistingInviteSent', { name: addUserFound.name }), { duration: 8000 });
    setAddUserModal(false);
  }

  // When the list spans several blocks, show which block each person belongs to —
  // otherwise the rows are ambiguous in a compound view.
  const showBlockColumn = listBuildingIds.length > 1;
  // 0151: invited accounts stay pending until they first sign in - they show
  // under Invitations (the tab where an admin looks for "not here yet").
  const pendingAccounts = users.filter(u => u.status === 'pending');
  const blockName = useMemo(
    () => Object.fromEntries(buildings.map(b => [b.id, b.name])) as Record<string, string>,
    [buildings],
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: t('users.allUsers') },
    { key: 'invites', label: t('users.invitationsTab') },
  ];

  const showContent = listBuildingIds.length > 0 || isSuperAdmin;

  const rolesForInviteScope = inviteScopeType === 'org' ? ORG_ROLES : inviteScopeType === 'compound' ? COMPOUND_ROLES : BUILDING_ROLES;
  // Ladder: callers may only hand out roles strictly below their own rank
  // (mirrors the invite-user edge function's whitelists).
  const buildingRolesForCaller = (isSuperAdmin || isOrgAdmin || isCompoundAdmin)
    ? BUILDING_ROLES
    : BUILDING_ROLES.filter(r => r !== 'building_admin');
  // Server authorizes building & compound admins to invite within their scope too.
  const canInvite = isSuperAdmin || isOrgAdmin || isCompoundAdmin || isBuildingAdmin;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <h1 className="text-xl font-semibold text-foreground">{t('users.title')}</h1>
        <div className="flex gap-2">
          {canInvite && (
            <>
              <Button variant="secondary" onClick={openAddUserModal}>
                <UserPlus size={16} /> {t('users.addExisting')}
              </Button>
              <Button variant="secondary" onClick={openInviteModal}>
                <Mail size={16} /> {t('users.inviteUser')}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Entity selection moved to the sidebar (global) — only the optional
          block drill-down stays here. */}
      {showBuildingSelector && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          {selEntity?.kind === 'compound' && selEntity.blocks.length > 1 && (
            <RadixSelect value={blockFilter || '__all__'} onValueChange={v => setBlockFilter(v === '__all__' ? '' : v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t('finance.allBlocks')}</SelectItem>
                {selEntity.blocks.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </RadixSelect>
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
          <SegmentedTabs
            className="mb-4"
            value={tab}
            onChange={setTab}
            tabs={tabs}
          />

          {tab === 'invites' ? (
            // Invitations tab: every unit invitation in scope, any status —
            // the tracking view for the consent flow (0053/0055).
            !listBuildingIds.length ? (
              <Card><CardBody><p className="text-sm text-muted-foreground text-center py-8">{t('users.selectBuildingHint')}</p></CardBody></Card>
            ) : invitesLoading ? (
              <SkeletonTable rows={4} cols={6} />
            ) : (
              <>
              {pendingAccounts.length > 0 && (
                <Card className="mb-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                          <th className="px-4 py-3 text-start font-medium">{t('users.name')}</th>
                          {showBlockColumn && <th className="px-4 py-3 text-start font-medium">{t('users.block')}</th>}
                          <th className="px-4 py-3 text-start font-medium">{t('users.inviteSentOn')}</th>
                          <th className="px-4 py-3 text-start font-medium">{t('users.status')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {pendingAccounts.map(u => (
                          <tr key={u.id} className="hover:bg-accent/30">
                            <td className="px-4 py-3">
                              <p className="font-medium text-foreground">{u.full_name}</p>
                              <p className="text-xs text-muted-foreground">{t('users.awaitingTitle')}</p>
                            </td>
                            {showBlockColumn && (
                              <td className="px-4 py-3"><span className="text-xs text-muted-foreground">{blockName[u.building_id ?? ''] ?? '—'}</span></td>
                            )}
                            <td className="px-4 py-3 text-muted-foreground">{fmtDate(u.created_at)}</td>
                            <td className="px-4 py-3"><Badge color="yellow">{t('users.awaitingBadge')}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
              {invites.length === 0 ? (
              <Card><CardBody><p className="text-sm text-muted-foreground text-center py-8">{t('users.noInvites')}</p></CardBody></Card>
            ) : (
              <Card>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                        <th className="px-4 py-3 text-start font-medium">{t('users.name')}</th>
                        <th className="px-4 py-3 text-start font-medium">{t('users.apartment')}</th>
                        {showBlockColumn && <th className="px-4 py-3 text-start font-medium">{t('users.block')}</th>}
                        <th className="px-4 py-3 text-start font-medium">{t('users.invitedBy')}</th>
                        <th className="px-4 py-3 text-start font-medium">{t('users.inviteSentOn')}</th>
                        <th className="px-4 py-3 text-start font-medium">{t('users.status')}</th>
                        <th className="px-4 py-3 text-start font-medium">{t('common.actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {invites.map(inv => {
                        const days = Math.max(0, Math.ceil((new Date(inv.expires_at).getTime() - Date.now()) / 86400000));
                        return (
                          <tr key={inv.id} className="hover:bg-accent/30">
                            <td className="px-4 py-3">
                              <p className="font-medium text-foreground">{inv.user_name}</p>
                              <p className="text-xs text-muted-foreground">{t(`structure.tenure.${inv.tenure}`, { defaultValue: inv.tenure })}</p>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-xs rounded-full px-2 py-0.5 bg-primary/10 text-primary">{inv.unit_label}</span>
                            </td>
                            {showBlockColumn && (
                              <td className="px-4 py-3"><span className="text-xs text-muted-foreground">{inv.building_name}</span></td>
                            )}
                            <td className="px-4 py-3 text-muted-foreground">{inv.invited_by_name}</td>
                            <td className="px-4 py-3 text-muted-foreground">{fmtDate(inv.created_at)}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-0.5 items-start">
                                <Badge color={inviteStatusColor[inv.status]}>
                                  {t(`users.inviteStatuses.${inv.status}`, { defaultValue: inv.status })}
                                </Badge>
                                {inv.status === 'pending' && (
                                  <span className="text-[11px] text-muted-foreground">{t('users.inviteExpiresIn', { days })}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5">
                                {/* Accepted = membership exists, nothing to re-send.
                                    Resend restarts the notification + email + 14d clock. */}
                                {inv.status !== 'accepted' && (
                                  <Button size="sm" variant="secondary" disabled={resendingId === inv.id} onClick={() => resendInvite(inv)}>
                                    {t('users.inviteResend')}
                                  </Button>
                                )}
                                {(inv.status === 'pending' || inv.status === 'expired') && (
                                  <Button size="sm" variant="danger" onClick={() => withdrawInvite(inv.id)}>
                                    {t('users.inviteWithdraw')}
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
              </>
            )
          ) : (
            // All-users list spans every block of the selected entity — the data
            // loads for listBuildingIds, so don't hide it behind a single-block pick.
            !listBuildingIds.length ? (
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
                        <tr
                          key={u.id}
                          onClick={() => canEditProfile(u) && openEdit(u)}
                          className={`hover:bg-accent/30 ${canEditProfile(u) ? 'cursor-pointer' : ''}`}
                        >
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
                            {(assigned[u.id]?.length || pendingInvites[u.id]?.length) ? (
                              <div className="flex flex-wrap gap-1">
                                {assigned[u.id]?.map((m) => (
                                  <span key={m.label} className={`text-xs rounded-full px-2 py-0.5 ${m.tenure === 'tenant' ? 'bg-amber-50 text-amber-700' : 'bg-primary/10 text-primary'}`}>{m.label}</span>
                                ))}
                                {/* Consent flow (0053): invitation sent, awaiting their answer.
                                    ✕ withdraws it (e.g. to re-send after fixing email). */}
                                {pendingInvites[u.id]?.map((inv) => (
                                  <span
                                    key={inv.id}
                                    onClick={e => e.stopPropagation()}
                                    title={t('users.invitePendingTitle')}
                                    className="inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30"
                                  >
                                    ⏳ {inv.label}
                                    <button
                                      onClick={() => withdrawInvite(inv.id)}
                                      title={t('users.inviteWithdraw')}
                                      className="hover:text-red-500 cursor-pointer leading-none"
                                    >
                                      ×
                                    </button>
                                  </span>
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
                          {/* interactive cells must not trigger the row's open-edit click */}
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <div className="flex flex-col gap-1">
                              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={u.notify_email}
                                  onChange={e => {
                                    // ≥1 channel must stay on (DB constraint 0057)
                                    if (!e.target.checked && !u.notify_whatsapp) {
                                      toast.error(t('users.channelRequired', { name: u.full_name }));
                                      return;
                                    }
                                    updateUser(u.id, { notify_email: e.target.checked });
                                  }}
                                  className="rounded accent-primary"
                                />
                                {t('users.notifyEmail')}
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={u.notify_whatsapp}
                                  onChange={e => {
                                    if (e.target.checked && !u.phone?.trim()) {
                                      toast.error(t('users.whatsappNeedsPhone', { name: u.full_name }));
                                      return;
                                    }
                                    if (!e.target.checked && !u.notify_email) {
                                      toast.error(t('users.channelRequired', { name: u.full_name }));
                                      return;
                                    }
                                    updateUser(u.id, { notify_whatsapp: e.target.checked });
                                  }}
                                  className="rounded accent-primary"
                                />
                                {t('users.notifyWhatsapp')}
                              </label>
                            </div>
                          </td>
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-1.5">
                              {u.status === 'active' && u.id !== profile?.id && (
                                <Button size="sm" variant="secondary" onClick={() => { setDeactivateReason(''); setDeactivateTarget(u); }}>{t('users.deactivate')}</Button>
                              )}
                              {u.status === 'inactive' && (
                                <Button size="sm" onClick={() => reactivateUser(u.id)}>{t('common.reactivate')}</Button>
                              )}
                              {/* Edit name/phone: click the row (see <tr> onClick). */}
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
            placeholder="Sami Karam"
          />
          <Input
            label={t('users.inviteEmail')}
            type="email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            placeholder="sami@example.com"
          />
          <PhoneInput
            label={t('users.invitePhone')}
            value={invitePhone}
            onChange={setInvitePhone}
          />

          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t('users.inviteRoleSection')}</p>

            {/* One flat pill row: Resident, then each building role directly —
                no intermediate "Building-level" hop and no Role dropdown.
                Compound/Org stay as entry pills for their own role lists.
                Selected = the calm tinted primary, never the neon fill. */}
            <div className="flex gap-1 flex-wrap mb-3">
              {([
                { key: 'resident', on: inviteScopeType === 'none',
                  pick: () => setInviteScopeType('none'),
                  label: t('users.inviteScope.none') },
                ...buildingRolesForCaller.map(r => ({
                  key: r, on: inviteScopeType === 'building' && inviteGrantRole === r,
                  pick: () => { setInviteScopeType('building'); setInviteGrantRole(r); },
                  label: t(`users.roles.${r}`) })),
                ...((isSuperAdmin || (isOrgAdmin && compoundEntities.length > 0)) ? [{
                  key: 'compound', on: inviteScopeType === 'compound',
                  pick: () => { setInviteScopeType('compound'); setInviteGrantRole('compound_admin'); },
                  label: t('users.inviteScope.compound') }] : []),
                ...(isSuperAdmin ? [{
                  key: 'org', on: inviteScopeType === 'org',
                  pick: () => { setInviteScopeType('org'); setInviteGrantRole('org_admin'); },
                  label: t('users.inviteScope.org') }] : []),
              ]).map(pIt => (
                <button
                  key={pIt.key}
                  type="button"
                  onClick={pIt.pick}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition cursor-pointer ${pIt.on ? 'bg-primary/15 border-primary/40 text-primary font-medium' : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
                >
                  {pIt.label}
                </button>
              ))}
            </div>

            {/* Plain resident: no management grant, but they must belong to a
                building — it drives People-list visibility and unit assignment. */}
            {inviteScopeType === 'none' && (
              <SelectField
                label={t('users.inviteResidentBuilding')}
                value={inviteBuildingId || '__none__'}
                onValueChange={v => setInviteBuildingId(v === '__none__' ? '' : v)}
              >
                <SelectItem value="__none__">{t('common.selectBuilding')}</SelectItem>
                {buildings.map(b => <SelectItem key={b.id} value={b.id}>{b.name} ({b.city})</SelectItem>)}
              </SelectField>
            )}

            {/* The role is already the selected pill — only the building remains. */}
            {inviteScopeType === 'building' && (
              <SelectField
                label={t('users.inviteBuilding')}
                value={inviteBuildingId || '__none__'}
                onValueChange={v => setInviteBuildingId(v === '__none__' ? '' : v)}
              >
                <SelectItem value="__none__">{t('common.selectBuilding')}</SelectItem>
                {buildings.map(b => <SelectItem key={b.id} value={b.id}>{b.name} ({b.city})</SelectItem>)}
              </SelectField>
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
              disabled={!inviteEmail.trim() || !inviteFullName.trim() || (inviteScopeType === 'none' && !inviteBuildingId)}
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



      {/* ── Add existing Abniyah user (by email) ────────────────────────────
          One account, many units: someone provisioned elsewhere gives their
          email; we link them to a unit here. No new account, no invite email. */}
      <Modal open={addUserModal} onClose={() => setAddUserModal(false)} title={t('users.addExisting')} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('users.addExistingHint')}</p>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label={t('users.inviteEmail')}
                type="email"
                value={addUserEmail}
                onChange={e => { setAddUserEmail(e.target.value); setAddUserFound(null); }}
                placeholder="name@example.com"
              />
            </div>
            <Button variant="secondary" onClick={findAbniyahUser} loading={addUserFinding} disabled={!addUserEmail.trim()}>
              <Search size={15} /> {t('users.findUser')}
            </Button>
          </div>

          {addUserFound === 'notfound' && (
            <p className="text-sm text-destructive">{t('users.addExistingNotFound')}</p>
          )}

          {addUserFound && addUserFound !== 'notfound' && (
            <>
              <p className="text-sm">
                <span className="text-muted-foreground">{t('users.addExistingFound')}</span>{' '}
                <span className="font-semibold text-foreground">{addUserFound.name}</span>
              </p>

              {buildings.length > 1 && (
                <SelectField
                  label={t('users.inviteResidentBuilding')}
                  value={addUserBuildingId || '__none__'}
                  onValueChange={v => setAddUserBuildingId(v === '__none__' ? '' : v)}
                >
                  <SelectItem value="__none__">{t('common.selectBuilding')}</SelectItem>
                  {buildings.map(b => <SelectItem key={b.id} value={b.id}>{b.name} ({b.city})</SelectItem>)}
                </SelectField>
              )}

              {addUserBuildingId && (
                addUserUnitsLoading ? (
                  <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
                ) : addUserUnits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('users.addExistingNoUnits')}</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <SelectField
                      label={t('users.addExistingUnit')}
                      value={addUserUnitId || '__none__'}
                      onValueChange={v => setAddUserUnitId(v === '__none__' ? '' : v)}
                    >
                      <SelectItem value="__none__">—</SelectItem>
                      {addUserUnits.map(u => <SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>)}
                    </SelectField>
                    <SelectField
                      label={t('users.addExistingTenure')}
                      value={addUserTenure}
                      onValueChange={v => setAddUserTenure(v as 'owner' | 'tenant')}
                    >
                      <SelectItem value="owner">{t('users.tenureOwner')}</SelectItem>
                      <SelectItem value="tenant">{t('users.tenureTenant')}</SelectItem>
                    </SelectField>
                  </div>
                )
              )}
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setAddUserModal(false)}>{t('common.cancel')}</Button>
            <Button
              onClick={addAbniyahUser}
              loading={addUserSaving}
              disabled={!addUserFound || addUserFound === 'notfound' || !addUserUnitId}
            >
              <UserPlus size={15} /> {t('users.addExistingConfirm')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit profile modal — name + phone only; identity fields are self-service */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit User" size="sm">
        <div className="space-y-4">
          <Input
            label={t('users.inviteFullName')}
            value={editForm.full_name}
            onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))}
          />
          <PhoneInput
            label={t('users.invitePhone')}
            value={editForm.phone}
            onChange={(v) => setEditForm(f => ({ ...f, phone: v }))}
          />

          {/* Identity facts — visible, never editable here */}
          <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{t('users.inviteEmail')}</span>
              <span className="text-sm text-foreground truncate flex items-center gap-1.5">
                <Lock size={11} className="text-muted-foreground shrink-0" />
                {editIdentity ? editIdentity.email : '…'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{t('settings.mfaTitle')}</span>
              <span className="flex items-center gap-1.5">
                <Lock size={11} className="text-muted-foreground shrink-0" />
                {editIdentity === null ? (
                  <span className="text-sm text-muted-foreground">…</span>
                ) : editIdentity.mfa_enabled ? (
                  <Badge color="green">{t('settings.mfaStatusOn')}</Badge>
                ) : (
                  <Badge color="slate">{t('settings.mfaStatusOff')}</Badge>
                )}
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('users.editIdentityNote')}
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setEditTarget(null)}>{t('common.cancel')}</Button>
            <Button onClick={saveEdit} loading={editSaving} disabled={!editForm.full_name.trim()}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
