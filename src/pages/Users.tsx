import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Profile, UserRole, UserStatus, Building } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

const roleColor: Record<UserRole, 'blue' | 'orange' | 'slate'> = {
  super_admin: 'blue', building_admin: 'orange', resident: 'slate',
};
const statusColor: Record<UserStatus, 'green' | 'yellow' | 'red' | 'slate'> = {
  active: 'green', pending: 'yellow', rejected: 'red', inactive: 'slate',
};

export default function Users() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';

  const [users, setUsers] = useState<Profile[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'all' | 'pending'>('all');
  const [assigned, setAssigned] = useState<Record<string, string[]>>({});

  // Super admin: load all buildings to pick from
  useEffect(() => {
    if (!isSuperAdmin) return;
    supabase.from('buildings').select('*').eq('is_active', true).order('name')
      .then(({ data }) => setBuildings(data ?? []));
  }, [isSuperAdmin]);

  const activeBuildingId = isSuperAdmin ? selectedBuildingId : profile?.building_id ?? '';

  useEffect(() => {
    if (activeBuildingId) loadUsers();
  }, [activeBuildingId, tab]);

  async function loadUsers() {
    setLoading(true);
    let q = supabase.from('profiles').select('*').eq('building_id', activeBuildingId);
    if (tab === 'pending') q = q.eq('status', 'pending');
    q = q.order('created_at', { ascending: false });
    const { data } = await q;
    setUsers(data ?? []);
    setLoading(false);

    // assigned units (from memberships) for this building
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

  async function updateUser(id: string, patch: Partial<Profile>) {
    await supabase.from('profiles').update(patch).eq('id', id);
    loadUsers();
  }

  const pendingCount = users.filter(u => u.status === 'pending').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-900">{t('users.title')}</h1>
      </div>

      {/* Super admin: building selector */}
      {isSuperAdmin && (
        <div className="mb-4">
          <select
            value={selectedBuildingId}
            onChange={e => { setSelectedBuildingId(e.target.value); setTab('all'); }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[240px]"
          >
            <option value="">— Select a building —</option>
            {buildings.map(b => (
              <option key={b.id} value={b.id}>{b.name} ({b.city})</option>
            ))}
          </select>
        </div>
      )}

      {!activeBuildingId ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500 text-center py-8">
              Select a building above to manage its users.
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="flex gap-2 mb-4">
            {(['all', 'pending'] as const).map(t2 => (
              <button
                key={t2}
                onClick={() => setTab(t2)}
                className={`text-sm px-4 py-1.5 rounded-lg border transition cursor-pointer ${tab === t2 ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
              >
                {t2 === 'all' ? 'All Users' : t('users.pendingApprovals')}
                {t2 === 'pending' && pendingCount > 0 && (
                  <span className="ms-1.5 bg-yellow-400 text-yellow-900 text-xs rounded-full px-1.5">{pendingCount}</span>
                )}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">{t('common.loading')}</p>
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
                              Email
                            </label>
                            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                              <input type="checkbox" checked={u.notify_whatsapp} onChange={e => updateUser(u.id, { notify_whatsapp: e.target.checked })} className="rounded" />
                              WhatsApp
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
                              <Button size="sm" onClick={() => updateUser(u.id, { status: 'active' })}>Reactivate</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
