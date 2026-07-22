import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Layers, Home, Users2, Trash2, Pencil, UserPlus, X, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useManagedBuildings } from '@/lib/useManagedBuildings';
import type { Unit, Group, Occupancy, Tenure } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RadixSelect, SelectField, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/Select';
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
  const { can, isPlatformAdmin, grants, user } = useAuth();
  const { buildings } = useManagedBuildings();
  // Fresh org/compound admins land here with zero buildings — point them to
  // the Buildings page instead of a dead-end empty state.
  const canCreateBuildings = isPlatformAdmin || grants.some(g => ['org_admin', 'compound_admin'].includes(g.role));
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
  const [unitForm, setUnitForm] = useState({ label: '', share_weight: '1', occupancy: 'occupied' as Occupancy, opening_balance: '', opening_balance_date: '' });
  const [assignLicense, setAssignLicense] = useState(true);
  // License pool for this building's subscription (resolves building → compound → org).
  const [subInfo, setSubInfo] = useState<{ id: string; available_count: number } | null>(null);
  // unit_id → active license_assignment id (drives the checkbox state in edit mode)
  const [licensedMap, setLicensedMap] = useState<Record<string, string>>({});
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

  // License pool — used by the "assign a license" checkbox in the unit form.
  useEffect(() => {
    if (!buildingId) { setSubInfo(null); return; }
    supabase.rpc('get_building_subscription', { p_building_id: buildingId }).then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : data;
      setSubInfo(row ? { id: row.id, available_count: Number(row.available_count) } : null);
    });
  }, [buildingId]);

  // Which of this building's units hold an active license (for the edit toggle).
  useEffect(() => {
    if (!subInfo || !units.length) { setLicensedMap({}); return; }
    supabase.from('license_assignments').select('id, unit_id')
      .eq('subscription_id', subInfo.id).is('unassigned_at', null)
      .in('unit_id', units.map((u) => u.id))
      .then(({ data }) => {
        const m: Record<string, string> = {};
        for (const r of ((data ?? []) as { id: string; unit_id: string }[])) m[r.unit_id] = r.id;
        setLicensedMap(m);
      });
  }, [subInfo, units]);

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
        supabase.from('memberships').select('id, user_id, unit_id, tenure').in('unit_id', unitIds).is('ended_at', null),
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
      ? { label: edit.label, share_weight: String(edit.share_weight), occupancy: edit.occupancy,
          opening_balance: edit.opening_balance ? String(edit.opening_balance) : '',
          opening_balance_date: edit.opening_balance_date ?? '' }
      : { label: '', share_weight: '1', occupancy: 'occupied', opening_balance: '', opening_balance_date: '' });
    // Edit: reflect the unit's current license; create: default to assigning one.
    setAssignLicense(edit ? !!licensedMap[edit.id] : true);
    setUnitModal({ open: true, edit });
  }
  async function saveUnit() {
    // Opening balance is signed: + = credit, − = owes. Only send a date when a
    // balance is set, so an empty field means "no carried-in balance".
    const ob = unitForm.opening_balance.trim() === '' ? 0 : Number(unitForm.opening_balance);
    const payload = {
      building_id: buildingId,
      label: unitForm.label.trim(),
      share_weight: Number(unitForm.share_weight) || 1,
      occupancy: unitForm.occupancy,
      opening_balance: Number.isFinite(ob) ? ob : 0,
      opening_balance_date: ob !== 0 ? (unitForm.opening_balance_date || new Date().toISOString().slice(0, 10)) : null,
    };
    if (!payload.label) return;
    if (unitModal.edit) {
      await supabase.from('units').update(payload).eq('id', unitModal.edit.id);
      // License toggle: apply the delta between current state and checkbox.
      const uid = unitModal.edit.id;
      const currentAssignment = licensedMap[uid];
      if (subInfo && assignLicense && !currentAssignment && subInfo.available_count > 0) {
        const { error: licErr } = await supabase.from('license_assignments').insert({
          subscription_id: subInfo.id, unit_id: uid, assigned_by: user?.id ?? null,
        });
        if (licErr) {
          toast.warning(t('structure.licenseAssignFailed'));
        } else {
          await supabase.from('subscription_events').insert({
            subscription_id: subInfo.id, event_type: 'license_assigned', actor_id: user?.id ?? null,
            metadata: { unit_id: uid, unit_label: payload.label, via: 'unit_edit' },
          });
          setSubInfo({ ...subInfo, available_count: subInfo.available_count - 1 });
        }
      } else if (subInfo && !assignLicense && currentAssignment) {
        const { error: licErr } = await supabase.from('license_assignments')
          .update({ unassigned_at: new Date().toISOString(), unassigned_by: user?.id ?? null })
          .eq('id', currentAssignment);
        if (!licErr) {
          await supabase.from('subscription_events').insert({
            subscription_id: subInfo.id, event_type: 'license_unassigned', actor_id: user?.id ?? null,
            metadata: { unit_id: uid, unit_label: payload.label, via: 'unit_edit' },
          });
          setSubInfo({ ...subInfo, available_count: subInfo.available_count + 1 });
        }
      }
    } else {
      const { data: created, error } = await supabase.from('units').insert(payload).select('id').single();
      if (error) { toast.error(error.message); return; }
      // Assign-on-create: consume one license from the pool for the new unit.
      if (assignLicense && subInfo && subInfo.available_count > 0 && created) {
        const { error: licErr } = await supabase.from('license_assignments').insert({
          subscription_id: subInfo.id, unit_id: created.id, assigned_by: user?.id ?? null,
        });
        if (licErr) {
          toast.warning(t('structure.licenseAssignFailed'));
        } else {
          await supabase.from('subscription_events').insert({
            subscription_id: subInfo.id, event_type: 'license_assigned', actor_id: user?.id ?? null,
            metadata: { unit_id: created.id, unit_label: payload.label, via: 'unit_create' },
          });
          setSubInfo({ ...subInfo, available_count: subInfo.available_count - 1 });
        }
      }
    }
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
  // Move-out = soft-end (0026). Never hard-delete: the unit's ledger needs to know
  // who was liable when each charge was raised (owner vs tenant billing).
  async function removeOwner(membershipId: string) {
    const { error } = await supabase.rpc('end_membership', { p_membership: membershipId });
    if (error) { toast.error(error.message); return; }
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
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('structure.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('structure.subtitle')}</p>
        </div>
        {buildings.length > 1 && (
          <RadixSelect value={buildingId} onValueChange={setBuildingId}>
            <SelectTrigger className="min-w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {compoundList.filter((c) => buildings.some((b) => b.compound_id === c.id)).map((c) => (
                <SelectGroup key={c.id}>
                  <SelectLabel>{c.name}</SelectLabel>
                  {buildings.filter((b) => b.compound_id === c.id).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectGroup>
              ))}
              {buildings.filter((b) => !b.compound_id).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </RadixSelect>
        )}
      </div>

      {!buildingId ? (
        <Card><CardBody>
          <div className="text-center py-10">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Building2 size={22} className="text-primary" />
            </div>
            <p className="text-sm text-muted-foreground mb-4">{t('structure.noBuildings')}</p>
            {canCreateBuildings && (
              <Link
                to="/buildings"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
              >
                <Plus size={14} /> {t('structure.createFirstBuilding')}
              </Link>
            )}
          </div>
        </CardBody></Card>
      ) : !canManage ? (
        <Card><CardBody><p className="text-sm text-muted-foreground text-center py-10">{t('structure.noAccess')}</p></CardBody></Card>
      ) : (
        <>
          {/* tabs */}
          <div className="inline-flex p-1 bg-accent/30 rounded-xl mb-5">
            {([['units', t('structure.units'), Home], ['groups', t('structure.groups'), Users2]] as [('units'|'groups'), string, typeof Home][]).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 text-sm font-medium px-4 py-1.5 rounded-lg transition cursor-pointer ${tab === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
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
                    <Layers className="mx-auto text-primary mb-2" size={28} />
                    <p className="text-sm text-muted-foreground">{t('structure.noUnits')}</p>
                  </div></CardBody></Card>
                ) : (
                  <Card>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                            <th className="px-5 py-3 text-start font-medium">{t('structure.unit')}</th>
                            <th className="px-5 py-3 text-start font-medium">{t('structure.members')}</th>
                            <th className="px-5 py-3 text-start font-medium">{t('structure.shares')}</th>
                            <th className="px-5 py-3 text-start font-medium">{t('structure.occupancy')}</th>
                            <th className="px-5 py-3 text-end font-medium">{t('common.actions')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {units.map((u) => {
                            const ow = ownersOf(u.id);
                            const pct = totalShares > 0 ? (Number(u.share_weight) / totalShares) * 100 : 0;
                            return (
                              <tr key={u.id} className="hover:bg-accent/30">
                                <td className="px-5 py-3 font-semibold text-foreground">{u.label}</td>
                                <td className="px-5 py-3">
                                  {ow.length === 0 ? <span className="text-muted-foreground">&#8212;</span> : (
                                    <div className="flex flex-wrap gap-1">
                                      {ow.map((o) => (
                                        <span key={o.id} className={`inline-flex items-center gap-1 text-xs rounded-full ps-2 pe-1 py-0.5 ${o.tenure === 'tenant' ? 'bg-amber-100 text-amber-800' : 'bg-primary/15 text-primary'}`}>
                                          {profileName[o.user_id] ?? 'User'}
                                          <span className="opacity-60 text-[10px]">· {t(`structure.tenure.${o.tenure}`)}</span>
                                          <button onClick={() => removeOwner(o.id)} className="opacity-50 hover:opacity-100 hover:text-rose-500 cursor-pointer"><X size={11} /></button>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </td>
                                <td className="px-5 py-3 text-muted-foreground tnum">
                                  {Number(u.share_weight)} <span className="text-muted-foreground text-xs">({pct.toFixed(1)}%)</span>
                                </td>
                                <td className="px-5 py-3"><Badge color={occupancyColor[u.occupancy]}>{t(`structure.${u.occupancy}`)}</Badge></td>
                                <td className="px-5 py-3">
                                  <div className="flex items-center justify-end gap-1">
                                    <button onClick={() => { setOwnerModal(u); setOwnerPick(''); setOwnerTenure('owner'); }} title={t('structure.assignMember')} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 cursor-pointer"><UserPlus size={15} /></button>
                                    <button onClick={() => openUnit(u)} title="Edit" className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"><Pencil size={15} /></button>
                                    <button onClick={() => deleteUnit(u.id)} title="Delete" className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-50 cursor-pointer"><Trash2 size={15} /></button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-border text-muted-foreground">
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
                  <Users2 className="mx-auto text-primary mb-2" size={28} />
                  <p className="text-sm text-muted-foreground">{t('structure.noGroups')}</p>
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
                              <p className="font-semibold text-foreground">{g.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">{t('structure.unitsCount', { count })}</p>
                            </div>
                            <button onClick={() => deleteGroup(g.id)} className="p-1 text-muted-foreground hover:text-rose-500 cursor-pointer"><Trash2 size={15} /></button>
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
            <SelectField label={t('structure.occupancy')} value={unitForm.occupancy} onValueChange={(v) => setUnitForm({ ...unitForm, occupancy: v as Occupancy })}>
              <SelectItem value="occupied">{t('structure.occupied')}</SelectItem>
              <SelectItem value="vacant">{t('structure.vacant')}</SelectItem>
              <SelectItem value="abroad">{t('structure.abroad')}</SelectItem>
            </SelectField>
          </div>

          {/* Opening balance — what the unit already owed/had in credit when it
              joined. Kept out of the P&L; folds into the running balance. */}
          <div className="rounded-xl border border-slate-200 dark:border-white/10 p-3 space-y-3">
            <p className="text-xs font-medium text-slate-500">{t('structure.openingBalance')}</p>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('structure.openingAmount')}
                type="number" step="0.01"
                placeholder="0.00"
                value={unitForm.opening_balance}
                onChange={(e) => setUnitForm({ ...unitForm, opening_balance: e.target.value })}
              />
              <Input
                label={t('structure.openingAsOf')}
                type="date"
                value={unitForm.opening_balance_date}
                onChange={(e) => setUnitForm({ ...unitForm, opening_balance_date: e.target.value })}
              />
            </div>
            <p className="text-[11px] text-slate-400">
              {Number(unitForm.opening_balance) < 0
                ? t('structure.openingOwes', { amt: Math.abs(Number(unitForm.opening_balance)).toLocaleString() })
                : Number(unitForm.opening_balance) > 0
                  ? t('structure.openingCredit', { amt: Number(unitForm.opening_balance).toLocaleString() })
                  : t('structure.openingHint')}
            </p>
          </div>

          {/* License toggle — create: assign on the go; edit: reflects the unit's
              current license, untick to unassign. Only when a subscription exists. */}
          {subInfo && (
            (subInfo.available_count > 0 || assignLicense) ? (
              <label className="flex items-center gap-2.5 text-sm text-foreground cursor-pointer rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={assignLicense}
                  onChange={(e) => setAssignLicense(e.target.checked)}
                  className="w-4 h-4 rounded cursor-pointer accent-primary"
                />
                <span>
                  {t('structure.assignLicense')}
                  <span className="text-xs text-muted-foreground ms-2">
                    {t('structure.licensesAvailable', { count: subInfo.available_count })}
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-xs text-muted-foreground rounded-xl border border-border px-3 py-2.5">
                {t('structure.noLicensesLeft')}{' '}
                <Link to="/licenses" className="text-primary font-medium hover:underline">{t('nav.licenses')}</Link>
              </p>
            )
          )}

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
                <span key={o.id} className={`inline-flex items-center gap-1 text-xs rounded-full ps-2 pe-1 py-1 ${o.tenure === 'tenant' ? 'bg-amber-100 text-amber-800' : 'bg-primary/15 text-primary'}`}>
                  {profileName[o.user_id] ?? 'User'} <span className="opacity-60">· {t(`structure.tenure.${o.tenure}`)}</span>
                  <button onClick={() => removeOwner(o.id)} className="opacity-50 hover:opacity-100 hover:text-rose-500 cursor-pointer"><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t('structure.addMember')} value={ownerPick || '__none__'} onValueChange={(v) => setOwnerPick(v === '__none__' ? '' : v)}>
              <SelectItem value="__none__">{t('structure.selectPerson')}</SelectItem>
              {profiles
                .filter((p) => !ownerModal || !ownersOf(ownerModal.id).some((o) => o.user_id === p.id))
                .map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}{p.apartment_number ? ` (${p.apartment_number})` : ''}</SelectItem>)}
            </SelectField>
            <SelectField label={t('structure.role')} value={ownerTenure} onValueChange={(v) => setOwnerTenure(v as Tenure)}>
              <SelectItem value="owner">{t('structure.tenure.owner')}</SelectItem>
              <SelectItem value="tenant">{t('structure.tenure.tenant')}</SelectItem>
            </SelectField>
          </div>
          <p className="text-xs text-muted-foreground">{t('structure.memberHint')}</p>
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
          {units.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">{t('structure.noUnitsToAdd')}</p> : units.map((u) => {
            const isIn = !!groupUnitsModal && unitGroups.some((x) => x.group_id === groupUnitsModal.id && x.unit_id === u.id);
            return (
              <label key={u.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent cursor-pointer">
                <input type="checkbox" checked={isIn} onChange={() => groupUnitsModal && toggleUnitInGroup(groupUnitsModal, u.id, isIn)} className="rounded" />
                <span className="text-sm text-foreground">{t('structure.unit')} {u.label}</span>
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
