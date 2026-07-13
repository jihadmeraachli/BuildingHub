import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Layers, Home, Users2, Trash2, Pencil, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import type { Unit, Group, Occupancy, Tenure } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { SkeletonTable } from '@/components/ui/Skeleton';

interface MiniProfile { id: string; full_name: string; apartment_number: string | null; }
interface OwnerRow { id: string; user_id: string; unit_id: string; tenure: Tenure; }

const occupancyColor: Record<Occupancy, 'green' | 'slate' | 'blue'> = {
  occupied: 'green', vacant: 'slate', abroad: 'blue',
};

export default function Structure() {
  const { t } = useTranslation();
  const { can, isPlatformAdmin } = useAuth();
  const { buildings } = useManagedBuildings();
  const [buildingId, setBuildingId] = useState('');
  const [compoundList, setCompoundList] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { supabase.from('compounds').select('id, name').then(({ data }) => setCompoundList((data as { id: string; name: string }[]) ?? [])); }, []);
  const [tab, setTab] = useState<'units' | 'groups'>('units');

  const [units, setUnits] = useState<Unit[]>([]);
  const [owners, setOwners] = useState<OwnerRow[]>([]);
  const [profiles, setProfiles] = useState<MiniProfile[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [unitGroups, setUnitGroups] = useState<{ group_id: string; unit_id: string }[]>([]);
  const [loading, setLoading] = useState(false);

  // modals
  const [unitModal, setUnitModal] = useState<{ open: boolean; edit?: Unit }>({ open: false });
  const [unitForm, setUnitForm] = useState({ label: '', share_weight: '1', occupancy: 'occupied' as Occupancy });
  const [ownerModal, setOwnerModal] = useState<Unit | null>(null);
  const [ownerPick, setOwnerPick] = useState('');
  const [ownerTenure, setOwnerTenure] = useState<Tenure>('owner');
  const [groupModal, setGroupModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupUnitsModal, setGroupUnitsModal] = useState<Group | null>(null);

  // auto-select first building
  useEffect(() => {
    if (!buildingId && buildings.length) setBuildingId(buildings[0].id);
  }, [buildings, buildingId]);

  const canManage = isPlatformAdmin || can('unit.manage', buildingId);

  useEffect(() => { if (buildingId) loadAll(); }, [buildingId]);

  async function loadAll() {
    setLoading(true);
    const [{ data: u }, { data: g }, { data: p }] = await Promise.all([
      supabase.from('units').select('*').eq('building_id', buildingId).order('label'),
      supabase.from('groups').select('*').eq('building_id', buildingId).order('name'),
      supabase.from('profiles').select('id, full_name, apartment_number').order('full_name'),
    ]);
    const unitList = (u as Unit[]) ?? [];
    setUnits(unitList);
    setGroups((g as Group[]) ?? []);
    setProfiles((p as MiniProfile[]) ?? []);

    const unitIds = unitList.map((x) => x.id);
    if (unitIds.length) {
      const [{ data: o }, { data: ug }] = await Promise.all([
        supabase.from('memberships').select('id, user_id, unit_id, tenure').in('unit_id', unitIds),
        supabase.from('unit_groups').select('group_id, unit_id').in('unit_id', unitIds),
      ]);
      setOwners((o as OwnerRow[]) ?? []);
      setUnitGroups((ug as { group_id: string; unit_id: string }[]) ?? []);
    } else {
      setOwners([]); setUnitGroups([]);
    }
    setLoading(false);
  }

  const profileName = useMemo(() => {
    const m: Record<string, string> = {};
    profiles.forEach((p) => { m[p.id] = p.full_name; });
    return m;
  }, [profiles]);

  function ownersOf(unitId: string) {
    return owners.filter((o) => o.unit_id === unitId);
  }

  // ---- unit CRUD ----
  function openUnit(edit?: Unit) {
    setUnitForm(edit
      ? { label: edit.label, share_weight: String(edit.share_weight), occupancy: edit.occupancy }
      : { label: '', share_weight: '1', occupancy: 'occupied' });
    setUnitModal({ open: true, edit });
  }
  async function saveUnit() {
    const payload = {
      building_id: buildingId,
      label: unitForm.label.trim(),
      share_weight: Number(unitForm.share_weight) || 1,
      occupancy: unitForm.occupancy,
    };
    if (!payload.label) return;
    if (unitModal.edit) await supabase.from('units').update(payload).eq('id', unitModal.edit.id);
    else await supabase.from('units').insert(payload);
    toast.success(t('common.saved'));
    setUnitModal({ open: false });
    loadAll();
  }
  async function deleteUnit(id: string) {
    if (!confirm('Delete this unit? Its charges and payments will be removed too.')) return;
    await supabase.from('units').delete().eq('id', id);
    loadAll();
  }

  // ---- owners ----
  async function addOwner() {
    if (!ownerModal || !ownerPick) return;
    await supabase.from('memberships').insert({ user_id: ownerPick, unit_id: ownerModal.id, tenure: ownerTenure });
    setOwnerPick(''); setOwnerTenure('owner');
    loadAll();
  }
  async function removeOwner(membershipId: string) {
    await supabase.from('memberships').delete().eq('id', membershipId);
    loadAll();
  }

  // ---- groups ----
  async function saveGroup() {
    if (!groupName.trim()) return;
    await supabase.from('groups').insert({ building_id: buildingId, name: groupName.trim() });
    setGroupName(''); setGroupModal(false);
    loadAll();
  }
  async function deleteGroup(id: string) {
    if (!confirm('Delete this group?')) return;
    await supabase.from('groups').delete().eq('id', id);
    loadAll();
  }
  async function toggleUnitInGroup(group: Group, unitId: string, isIn: boolean) {
    if (isIn) {
      await supabase.from('unit_groups').delete().eq('group_id', group.id).eq('unit_id', unitId);
    } else {
      await supabase.from('unit_groups').insert({ group_id: group.id, unit_id: unitId });
    }
    loadAll();
  }

  const totalShares = units.reduce((s, u) => s + Number(u.share_weight), 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('structure.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('structure.subtitle')}</p>
        </div>
        {buildings.length > 1 && (
          <Select value={buildingId} onChange={(e) => setBuildingId(e.target.value)} className="min-w-[220px]">
            {compoundList.filter((c) => buildings.some((b) => b.compound_id === c.id)).map((c) => (
              <optgroup key={c.id} label={c.name}>
                {buildings.filter((b) => b.compound_id === c.id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </optgroup>
            ))}
            {buildings.filter((b) => !b.compound_id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        )}
      </div>

      {!buildingId ? (
        <Card><CardBody><p className="text-sm text-slate-500 text-center py-10">{t('structure.noBuildings')}</p></CardBody></Card>
      ) : !canManage ? (
        <Card><CardBody><p className="text-sm text-slate-500 text-center py-10">{t('structure.noAccess')}</p></CardBody></Card>
      ) : (
        <>
          {/* tabs */}
          <div className="inline-flex p-1 bg-slate-100 rounded-xl mb-5">
            {([['units', t('structure.units'), Home], ['groups', t('structure.groups'), Users2]] as [('units'|'groups'), string, typeof Home][]).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 text-sm font-medium px-4 py-1.5 rounded-lg transition cursor-pointer ${tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>

          {tab === 'units' && (
            <>
              <div className="flex justify-end mb-3">
                <Button onClick={() => openUnit()}><Plus size={16} /> {t('structure.addUnit')}</Button>
              </div>
              {loading ? <SkeletonTable rows={5} cols={5} />
                : units.length === 0 ? (
                  <Card><CardBody><div className="text-center py-10">
                    <Layers className="mx-auto text-slate-300 mb-2" size={28} />
                    <p className="text-sm text-slate-500">{t('structure.noUnits')}</p>
                  </div></CardBody></Card>
                ) : (
                  <Card>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-100 text-slate-400 text-xs uppercase tracking-wide">
                            <th className="px-5 py-3 text-start font-medium">{t('structure.unit')}</th>
                            <th className="px-5 py-3 text-start font-medium">{t('structure.members')}</th>
                            <th className="px-5 py-3 text-start font-medium">{t('structure.shares')}</th>
                            <th className="px-5 py-3 text-start font-medium">{t('structure.occupancy')}</th>
                            <th className="px-5 py-3 text-end font-medium">{t('common.actions')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {units.map((u) => {
                            const ow = ownersOf(u.id);
                            const pct = totalShares > 0 ? (Number(u.share_weight) / totalShares) * 100 : 0;
                            return (
                              <tr key={u.id} className="hover:bg-slate-50/60">
                                <td className="px-5 py-3 font-semibold text-slate-900">{u.label}</td>
                                <td className="px-5 py-3">
                                  {ow.length === 0 ? <span className="text-slate-400">—</span> : (
                                    <div className="flex flex-wrap gap-1">
                                      {ow.map((o) => (
                                        <span key={o.id} className={`inline-flex items-center gap-1 text-xs rounded-full ps-2 pe-1 py-0.5 ${o.tenure === 'tenant' ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'}`}>
                                          {profileName[o.user_id] ?? 'User'}
                                          <span className="opacity-60 text-[10px]">· {t(`structure.tenure.${o.tenure}`)}</span>
                                          <button onClick={() => removeOwner(o.id)} className="opacity-50 hover:opacity-100 hover:text-rose-500 cursor-pointer"><X size={11} /></button>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </td>
                                <td className="px-5 py-3 text-slate-600 tnum">
                                  {Number(u.share_weight)} <span className="text-slate-400 text-xs">({pct.toFixed(1)}%)</span>
                                </td>
                                <td className="px-5 py-3"><Badge color={occupancyColor[u.occupancy]}>{t(`structure.${u.occupancy}`)}</Badge></td>
                                <td className="px-5 py-3">
                                  <div className="flex items-center justify-end gap-1">
                                    <button onClick={() => { setOwnerModal(u); setOwnerPick(''); setOwnerTenure('owner'); }} title={t('structure.assignMember')} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 cursor-pointer"><UserPlus size={15} /></button>
                                    <button onClick={() => openUnit(u)} title="Edit" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"><Pencil size={15} /></button>
                                    <button onClick={() => deleteUnit(u.id)} title="Delete" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"><Trash2 size={15} /></button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-slate-100 text-slate-500">
                            <td className="px-5 py-2.5 font-medium">{t('structure.unitsCount', { count: units.length })}</td>
                            <td />
                            <td className="px-5 py-2.5 tnum">{t('structure.sharesCount', { count: totalShares })}</td>
                            <td colSpan={2} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </Card>
                )}
            </>
          )}

          {tab === 'groups' && (
            <>
              <div className="flex justify-end mb-3">
                <Button onClick={() => { setGroupName(''); setGroupModal(true); }}><Plus size={16} /> {t('structure.addGroup')}</Button>
              </div>
              {groups.length === 0 ? (
                <Card><CardBody><div className="text-center py-10">
                  <Users2 className="mx-auto text-slate-300 mb-2" size={28} />
                  <p className="text-sm text-slate-500">{t('structure.noGroups')}</p>
                </div></CardBody></Card>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {groups.map((g) => {
                    const count = unitGroups.filter((x) => x.group_id === g.id).length;
                    return (
                      <Card key={g.id}>
                        <CardBody>
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-semibold text-slate-900">{g.name}</p>
                              <p className="text-xs text-slate-500 mt-0.5">{t('structure.unitsCount', { count })}</p>
                            </div>
                            <button onClick={() => deleteGroup(g.id)} className="p-1 text-slate-300 hover:text-rose-500 cursor-pointer"><Trash2 size={15} /></button>
                          </div>
                          <Button size="sm" variant="secondary" className="mt-3 w-full" onClick={() => setGroupUnitsModal(g)}>{t('structure.manageUnits')}</Button>
                        </CardBody>
                      </Card>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Unit modal */}
      <Modal open={unitModal.open} onClose={() => setUnitModal({ open: false })} title={unitModal.edit ? t('structure.editUnit') : t('structure.addUnit')}>
        <div className="space-y-4">
          <Input label={t('structure.unitLabel')} value={unitForm.label} onChange={(e) => setUnitForm({ ...unitForm, label: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('structure.shareWeight')} type="number" step="0.01" min="0" value={unitForm.share_weight} onChange={(e) => setUnitForm({ ...unitForm, share_weight: e.target.value })} />
            <Select label={t('structure.occupancy')} value={unitForm.occupancy} onChange={(e) => setUnitForm({ ...unitForm, occupancy: e.target.value as Occupancy })}>
              <option value="occupied">{t('structure.occupied')}</option>
              <option value="vacant">{t('structure.vacant')}</option>
              <option value="abroad">{t('structure.abroad')}</option>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setUnitModal({ open: false })}>{t('common.cancel')}</Button>
            <Button onClick={saveUnit}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      {/* Assign member modal */}
      <Modal open={!!ownerModal} onClose={() => setOwnerModal(null)} title={t('structure.assignMember', { label: ownerModal?.label ?? '' })}>
        <div className="space-y-4">
          {ownerModal && ownersOf(ownerModal.id).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {ownersOf(ownerModal.id).map((o) => (
                <span key={o.id} className={`inline-flex items-center gap-1 text-xs rounded-full ps-2 pe-1 py-1 ${o.tenure === 'tenant' ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'}`}>
                  {profileName[o.user_id] ?? 'User'} <span className="opacity-60">· {t(`structure.tenure.${o.tenure}`)}</span>
                  <button onClick={() => removeOwner(o.id)} className="opacity-50 hover:opacity-100 hover:text-rose-500 cursor-pointer"><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Select label={t('structure.addMember')} value={ownerPick} onChange={(e) => setOwnerPick(e.target.value)}>
              <option value="">{t('structure.selectPerson')}</option>
              {profiles
                .filter((p) => !ownerModal || !ownersOf(ownerModal.id).some((o) => o.user_id === p.id))
                .map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.apartment_number ? ` (${p.apartment_number})` : ''}</option>)}
            </Select>
            <Select label={t('structure.role')} value={ownerTenure} onChange={(e) => setOwnerTenure(e.target.value as Tenure)}>
              <option value="owner">{t('structure.tenure.owner')}</option>
              <option value="tenant">{t('structure.tenure.tenant')}</option>
            </Select>
          </div>
          <p className="text-xs text-slate-400">{t('structure.memberHint')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOwnerModal(null)}>{t('structure.done')}</Button>
            <Button onClick={addOwner} disabled={!ownerPick}>{t('common.add')}</Button>
          </div>
        </div>
      </Modal>

      {/* Add group modal */}
      <Modal open={groupModal} onClose={() => setGroupModal(false)} title={t('structure.addGroup')} size="sm">
        <div className="space-y-4">
          <Input label={t('structure.groupName')} value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={t('structure.groupNamePlaceholder')} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setGroupModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={saveGroup}>{t('structure.create')}</Button>
          </div>
        </div>
      </Modal>

      {/* Group units modal */}
      <Modal open={!!groupUnitsModal} onClose={() => setGroupUnitsModal(null)} title={t('structure.unitsInGroup', { name: groupUnitsModal?.name ?? '' })}>
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {units.length === 0 ? <p className="text-sm text-slate-500 py-4 text-center">{t('structure.noUnitsToAdd')}</p> : units.map((u) => {
            const isIn = !!groupUnitsModal && unitGroups.some((x) => x.group_id === groupUnitsModal.id && x.unit_id === u.id);
            return (
              <label key={u.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={isIn} onChange={() => groupUnitsModal && toggleUnitInGroup(groupUnitsModal, u.id, isIn)} className="rounded" />
                <span className="text-sm text-slate-800">{t('structure.unit')} {u.label}</span>
              </label>
            );
          })}
        </div>
        <div className="flex justify-end pt-3">
          <Button variant="secondary" onClick={() => setGroupUnitsModal(null)}>{t('structure.done')}</Button>
        </div>
      </Modal>
    </div>
  );
}
