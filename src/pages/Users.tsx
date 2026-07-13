import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Shield, Trash2, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Profile, UserRole, UserStatus, Building, Grant, GrantRole } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { SkeletonTable } from '@/components/ui/Skeleton';

type Tab = 'all' | 'pending' | 'access';

type GrantRow = Grant & {
  profiles: { id: string; full_name: string; apartment_number: string | null } | null;
};

const BUILDING_ROLES: GrantRole[] = ['building_admin', 'building_finance', 'viewer'];

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
  const { profile, isPlatformAdmin, can, canAny } = useAuth();
  const isSuperAdmin = isPlatformAdmin;

  const [users, setUsers] = useState<Profile[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const [assigned, setAssigned] = useState<Record<string, string[]>>({});

  // Grants state
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [grantLoading, setGrantLoading] = useState(false);
  const [grantModal, setGrantModal] = useState(false);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [grantUserId, setGrantUserId] = useState('');
  const [grantRole, setGrantRole] = useState<GrantRole>('building_finance');
  const [grantSearch, setGrantSearch] = useState('');

  useEffect(() => {
    if (!isSuperAdmin) return;
    supabase.from('buildings').select('*').eq('is_active', true).order('name')
      .then(({ data }) => setBuildings(data ?? []));
  }, [isSuperAdmin]);

  const activeBuildingId = isSuperAdmin ? selectedBuildingId : profile?.building_id ?? '';
  const canManageAccess = isPlatformAdmin || (activeBuildingId ? can('grant.manage', activeBuildingId) : canAny('grant.manage'));

  useEffect(() => {
    if (activeBuildingId && tab !== 'access') loadUsers();
  }, [activeBuildingId, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeBuildingId && tab === 'access') loadGrants();
  }, [activeBuildingId, tab]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const { data: ms } = await supabase.from('memberships').select('user_id, unit_id').in('unit_id', unitList.map((u) => u.id));
      const map: Record<string, string[]> = {};
      (ms as { user_id: string; unit_id: string }[] ?? []).forEach((m) => {
        (map[m.user_id] ??= []).push(unitLabel[m.unit_id]);
      });
      setAssigned(map);
    } else setAssigned({});
  }

  async function loadGrants() {
    if (!activeBuildingId) return;
    setGrantLoading(true);
    const { data } = await supabase
      .from('grants')
      .select('*, profiles(id, full_name, apartment_number)')
      .eq('building_id', activeBuildingId)
      .eq('scope_type', 'building')
      .order('created_at');
    setGrants((data as GrantRow[]) ?? []);
    setGrantLoading(false);
  }

  async function openGrantModal() {
    const { data } = await supabase.from('profiles').select('*').eq('status', 'active').order('full_name');
    setAllProfiles(data ?? []);
    setGrantUserId('');
    setGrantRole('building_finance');
    setGrantSearch('');
    setGrantModal(true);
  }

  async function addGrant() {
    if (!grantUserId || !activeBuildingId) return;
    const { error } = await supabase.from('grants').insert({
      user_id: grantUserId,
      scope_type: 'building',
      building_id: activeBuildingId,
      org_id: null,
      role: grantRole,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.grantAdded'));
    setGrantModal(false);
    loadGrants();
  }

  async function removeGrant(id: string) {
    const { error } = await supabase.from('grants').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(t('users.grantRemoved'));
    loadGrants();
  }

  async function updateUser(id: string, patch: Partial<Profile>) {
    await supabase.from('profiles').update(patch).eq('id', id);
    if (patch.status === 'active') toast.success(t('users.approved'));
    else if (patch.status === 'rejected') toast.success(t('users.rejected'));
    else if (patch.status === 'inactive') toast.success(t('users.deactivated'));
    loadUsers();
  }

  const pendingCount = users.filter(u => u.status === 'pending').length;
  const grantedUserIds = new Set(grants.map(g => g.user_id));
  const availableProfiles = allProfiles
    .filter(p => !grantedUserIds.has(p.id))
    .filter(p =>
      p.full_name.toLowerCase().includes(grantSearch.toLowerCase()) ||
      (p.apartment_number ?? '').toLowerCase().includes(grantSearch.toLowerCase())
    );

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'all', label: t('users.allUsers'), show: true },
    { key: 'pending', label: t('users.pendingApprovals'), show: true },
    { key: 'access', label: t('users.accessTab'), show: canManageAccess },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-900">{t('users.title')}</h1>
        {tab === 'access' && activeBuildingId && canManageAccess && (
          <Button onClick={openGrantModal}><UserPlus size={16} /> {t('users.addAccess')}</Button>
        )}
      </div>

      {isSuperAdmin && (
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

      {!activeBuildingId ? (
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
            grantLoading ? <SkeletonTable rows={4} cols={3} /> :
            grants.length === 0 ? (
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
                            <button
                              onClick={() => removeGrant(g.id)}
                              className="text-slate-300 hover:text-red-500 transition cursor-pointer"
                              title={t('users.revokeAccess')}
                            >
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
          ) : (
            loading ? (
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
                                {assigned[u.id].map((label) => (
                                  <span key={label} className="text-xs bg-indigo-50 text-indigo-700 rounded-full px-2 py-0.5">{label}</span>
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
                              {u.status === 'active' && (
                                <Button size="sm" variant="secondary" onClick={() => updateUser(u.id, { status: 'inactive' })}>{t('users.deactivate')}</Button>
                              )}
                              {u.status === 'inactive' && (
                                <Button size="sm" onClick={() => updateUser(u.id, { status: 'active' })}>{t('common.reactivate')}</Button>
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

      {/* Grant Access modal */}
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
                    key={p.id}
                    type="button"
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

          <Select
            label={t('users.role')}
            value={grantRole}
            onChange={e => setGrantRole(e.target.value as GrantRole)}
          >
            {BUILDING_ROLES.map(r => (
              <option key={r} value={r}>{t(`users.roles.${r}`, { defaultValue: r })}</option>
            ))}
          </Select>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setGrantModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={addGrant} disabled={!grantUserId}>{t('users.addAccess')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
