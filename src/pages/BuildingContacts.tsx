import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Phone, Pencil, Trash2, ContactRound, FileSignature } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useViewableBuildings } from '@/lib/useViewableBuildings';
import { useEntities } from '@/lib/entities';
import type { BuildingContact, ServiceContract } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { SkeletonCards } from '@/components/ui/Skeleton';

/**
 * Building directory (#59) — who to call. Two sources, zero duplication:
 * 1. Hand-added contacts (building_contacts, 0073): committee leader, natour,
 *    electrician… free-text title so any trade fits (Jey: fully dynamic).
 * 2. Service contracts that carry a phone — pulled in automatically so the
 *    elevator/generator/cleaning providers never need re-typing.
 */

// Quick-pick chips: common Lebanese building roles. They only pre-fill the
// free-text title — nothing is stored as an enum.
const SUGGESTIONS = [
  'committee', 'natour', 'electrician', 'plumber', 'painter',
  'generator', 'contractor', 'security', 'finance',
] as const;

type Form = { title: string; name: string; phone: string; scope: 'all' | 'block'; block_id: string };
const newForm = (): Form => ({ title: '', name: '', phone: '', scope: 'all', block_id: '' });

export default function BuildingContacts() {
  const { t } = useTranslation();
  const { can, isPlatformAdmin, profile, residentLens } = useAuth();
  const { buildings } = useViewableBuildings();
  const entities = useEntities(buildings);
  // GLOBAL entity selection (sidebar); '' = across all viewable buildings.
  const { entityKey } = useAuth();
  const [blockFilter, setBlockFilter] = useState('');
  const entity = entities.find((e) => e.key === entityKey) ?? null;
  useEffect(() => { setBlockFilter(''); }, [entityKey]);

  const [rows, setRows] = useState<BuildingContact[]>([]);
  const [contracts, setContracts] = useState<ServiceContract[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(newForm());

  const canManage = !residentLens && (isPlatformAdmin || !!entity?.buildingIds.some((id) => can('building.manage', id)));
  const multiBlock = (entity?.blocks.length ?? 0) > 1;
  const blockName = Object.fromEntries(buildings.map((b) => [b.id, b.name]));

  useEffect(() => { if (entity || buildings.length) load(); }, [entityKey, buildings.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!entity && !buildings.length) return;
    setLoading(true);
    const scoped = (table: string) => {
      if (entity) {
        return entity.kind === 'compound'
          ? supabase.from(table).select('*').or(`compound_id.eq.${entity.id},building_id.in.(${entity.buildingIds.join(',')})`)
          : supabase.from(table).select('*').eq('building_id', entity.id);
      }
      const bIds = buildings.map((b) => b.id).join(',');
      const cIds = entities.filter((e) => e.kind === 'compound').map((e) => e.id).join(',');
      return cIds
        ? supabase.from(table).select('*').or(`compound_id.in.(${cIds}),building_id.in.(${bIds})`)
        : supabase.from(table).select('*').in('building_id', buildings.map((b) => b.id));
    };
    const [{ data: c }, { data: sc }] = await Promise.all([
      scoped('building_contacts').order('title'),
      scoped('service_contracts').order('service'),
    ]);
    setRows((c as BuildingContact[]) ?? []);
    // Only contracts that actually carry a phone belong in a call list.
    setContracts(((sc as ServiceContract[]) ?? []).filter((r) => r.contact_phone));
    setLoading(false);
  }

  const inBlock = (r: { building_id: string | null }) => !blockFilter || r.building_id === blockFilter;
  const vRows = rows.filter(inBlock);
  const vContracts = contracts.filter(inBlock);

  function openNew() { setEditId(null); setForm(newForm()); setOpen(true); }
  function openEdit(r: BuildingContact) {
    setEditId(r.id);
    setForm({ title: r.title, name: r.name, phone: r.phone, scope: r.building_id ? 'block' : 'all', block_id: r.building_id ?? '' });
    setOpen(true);
  }

  async function save() {
    if (!entity || !form.title.trim()) return;
    setSaving(true);
    const compound_id = entity.kind === 'compound' && form.scope === 'all' ? entity.id : null;
    const building_id = entity.kind === 'building' ? entity.id : (form.scope === 'block' ? form.block_id : null);
    if (!compound_id && !building_id) { setSaving(false); return; }
    const base = { title: form.title.trim(), name: form.name.trim(), phone: form.phone.trim(), building_id, compound_id };
    const { error } = editId
      ? await supabase.from('building_contacts').update(base).eq('id', editId)
      : await supabase.from('building_contacts').insert({ ...base, created_by: profile?.id });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('common.saved'));
    setOpen(false); load();
  }

  async function remove(id: string) {
    if (!confirm(t('bcontacts.confirmDelete'))) return;
    const { error } = await supabase.from('building_contacts').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    load();
  }

  const scopeLabel = (r: { building_id: string | null; compound_id: string | null }) =>
    r.building_id ? (blockName[r.building_id] ?? '') : (r.compound_id ? t('finance.wholeCompound') : '');

  const telHref = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('bcontacts.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('bcontacts.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {entity?.kind === 'compound' && multiBlock && (
            <RadixSelect value={blockFilter || '__all__'} onValueChange={(v) => setBlockFilter(v === '__all__' ? '' : v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t('finance.allBlocks')}</SelectItem>
                {entity.blocks.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </RadixSelect>
          )}
          {canManage && entity && <Button onClick={openNew}><Plus size={16} /> {t('bcontacts.add')}</Button>}
        </div>
      </div>

      {loading ? <SkeletonCards count={3} /> : (
        <>
          {vRows.length === 0 && vContracts.length === 0 ? (
            <Card><CardBody><div className="text-center py-10">
              <ContactRound className="mx-auto text-primary mb-2" size={28} />
              <p className="text-sm text-muted-foreground">{canManage ? t('bcontacts.emptyAdmin') : t('bcontacts.empty')}</p>
            </div></CardBody></Card>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {vRows.map((r) => (
                <Card key={r.id}><CardBody>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-foreground">{r.title}</h3>
                      {scopeLabel(r) && <p className="text-[11px] text-muted-foreground mt-0.5">{scopeLabel(r)}</p>}
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"><Pencil size={14} /></button>
                        <button onClick={() => remove(r.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </div>
                  {r.name && <p className="text-sm text-muted-foreground mt-2">{r.name}</p>}
                  {r.phone && (
                    <a href={telHref(r.phone)} dir="ltr" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline mt-1">
                      <Phone size={13} /> {r.phone}
                    </a>
                  )}
                </CardBody></Card>
              ))}
            </div>
          )}

          {/* Providers already on file in Contracts — surfaced here automatically
              so nobody re-types (or duplicates) the elevator company's number. */}
          {vContracts.length > 0 && (
            <>
              <div className="flex items-center justify-between mt-8 mb-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{t('bcontacts.fromContracts')}</p>
                {!residentLens && (
                  <Link to="/contracts" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                    <FileSignature size={12} /> {t('bcontacts.manageInContracts')}
                  </Link>
                )}
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {vContracts.map((r) => (
                  <Card key={r.id}><CardBody>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-foreground">{r.service === 'other' && r.service_other ? r.service_other : t(`contracts.services.${r.service}`)}</h3>
                        {scopeLabel(r) && <p className="text-[11px] text-muted-foreground mt-0.5">{scopeLabel(r)}</p>}
                      </div>
                      <Badge color="indigo">{t('bcontacts.contractBadge')}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">{r.provider_name}{r.contact_name ? ` · ${r.contact_name}` : ''}</p>
                    {r.contact_phone && (
                      <a href={telHref(r.contact_phone)} dir="ltr" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline mt-1">
                        <Phone size={13} /> {r.contact_phone}
                      </a>
                    )}
                  </CardBody></Card>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? t('bcontacts.edit') : t('bcontacts.add')}>
        <div className="space-y-4">
          <div>
            <Input label={t('bcontacts.roleTitle')} value={form.title} placeholder={t('bcontacts.rolePlaceholder')} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setForm({ ...form, title: t(`bcontacts.suggest.${s}`) })}
                  className="px-2.5 py-1 rounded-full border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
                >
                  {t(`bcontacts.suggest.${s}`)}
                </button>
              ))}
            </div>
          </div>
          {entity?.kind === 'compound' && (
            <div className="grid grid-cols-2 gap-3">
              <SelectField label={t('finance.applyTo')} value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v as 'all' | 'block' })}>
                <SelectItem value="all">{t('finance.wholeCompound')}</SelectItem>
                <SelectItem value="block">{t('finance.aBlock')}</SelectItem>
              </SelectField>
              {form.scope === 'block' && (
                <SelectField label={t('finance.block')} value={form.block_id || '__none__'} onValueChange={(v) => setForm({ ...form, block_id: v === '__none__' ? '' : v })}>
                  <SelectItem value="__none__">—</SelectItem>
                  {entity.blocks.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectField>
              )}
            </div>
          )}
          <Input label={t('bcontacts.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <PhoneInput label={t('bcontacts.phone')} value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save} loading={saving} disabled={!form.title.trim()}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
