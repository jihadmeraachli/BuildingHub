import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '@/lib/dateFmt';
import { Plus, ClipboardCheck, Pencil, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/upload';
import { AttachmentLink } from '@/components/ui/AttachmentLink';
import { useAuth } from '@/contexts/AuthContext';
import { useViewableBuildings } from '@/lib/useViewableBuildings';
import { useEntities } from '@/lib/entities';
import { useAmenities, amenityLabel } from '@/lib/amenities';
import type { Inspection, InspectionCategory, InspectionStatus, BuildingContact } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { SkeletonCards } from '@/components/ui/Skeleton';

const CATEGORIES: InspectionCategory[] = ['generator', 'elevator', 'fire_safety', 'water_tank', 'electrical', 'hvac', 'other'];
const STATUSES: InspectionStatus[] = ['passed', 'failed', 'action_required', 'pending'];
const statusColor: Record<InspectionStatus, 'green' | 'red' | 'yellow' | 'slate'> = { passed: 'green', failed: 'red', action_required: 'yellow', pending: 'slate' };

type Form = {
  // 0123: the inspector/company is a contact pick, not free text. `inspector`
  // rides along as the denormalized display text — set from the picked
  // contact, or (editing a legacy row with no pick yet) left as it was.
  category: InspectionCategory; title: string; contact_id: string; inspector: string; inspection_date: string;
  status: InspectionStatus; outcome: string; next_due_date: string; scope: 'all' | 'block'; block_id: string;
  amenity_id: string; // 0112: '' = none
};
const newForm = (): Form => ({
  category: 'generator', title: '', contact_id: '', inspector: '', inspection_date: new Date().toISOString().slice(0, 10),
  status: 'pending', outcome: '', next_due_date: '', scope: 'all', block_id: '', amenity_id: '',
});

export default function Inspections() {
  const { t } = useTranslation();
  const { can, isPlatformAdmin, profile } = useAuth();
  const { buildings } = useViewableBuildings();
  const entities = useEntities(buildings);
  // GLOBAL entity selection (sidebar); '' = view across all viewable buildings
  // (adding an inspection still needs a specific entity picked).
  const { entityKey } = useAuth();
  const [blockFilter, setBlockFilter] = useState('');
  const entity = entities.find((e) => e.key === entityKey) ?? null;
  const amenities = useAmenities(entity?.kind, entity?.id); // 0112
  useEffect(() => { setBlockFilter(''); }, [entityKey]);

  // Time filter (#51): scoped on the inspection date, filtered client-side —
  // an entity's inspection list is small.
  const [period, setPeriod] = useState<'all' | 'year' | 'month'>('all');
  const [monthValue, setMonthValue] = useState(() => new Date().toISOString().slice(0, 7));

  const [rows, setRows] = useState<Inspection[]>([]);
  const [contacts, setContacts] = useState<BuildingContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(newForm());
  const [file, setFile] = useState<File | null>(null);

  const canManage = isPlatformAdmin || !!entity?.buildingIds.some((id) => can('building.manage', id));
  const multiBlock = (entity?.blocks.length ?? 0) > 1;
  const blockName = Object.fromEntries(buildings.map((b) => [b.id, b.name]));

  useEffect(() => { if (entity || buildings.length) load(); }, [entityKey, buildings.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!entity && !buildings.length) return;
    setLoading(true);
    // 0123: the same building/compound scope, applied to building_contacts
    // too — the inspector/company picker only ever offers contacts in scope.
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
    const [{ data }, { data: c }] = await Promise.all([
      scoped('inspections').order('inspection_date', { ascending: false }),
      scoped('building_contacts').order('title'),
    ]);
    setRows((data as Inspection[]) ?? []);
    setContacts((c as BuildingContact[]) ?? []);
    setLoading(false);
  }

  const inPeriod = (d: string) =>
    period === 'all' ? true
    : period === 'year' ? new Date(d).getFullYear() === new Date().getFullYear()
    : d.startsWith(monthValue);
  const vRows = rows.filter((r) => (!blockFilter || r.building_id === blockFilter) && inPeriod(r.inspection_date));

  function openNew() { setEditId(null); setForm(newForm()); setFile(null); setOpen(true); }
  function openEdit(r: Inspection) {
    setEditId(r.id); setFile(null);
    setForm({ category: r.category, title: r.title, contact_id: r.contact_id ?? '', inspector: r.inspector ?? '', inspection_date: r.inspection_date, status: r.status, outcome: r.outcome ?? '', next_due_date: r.next_due_date ?? '', scope: r.building_id ? 'block' : 'all', block_id: r.building_id ?? '', amenity_id: r.amenity_id ?? '' });
    setOpen(true);
  }

  /** 0123: the inspector/company is picked from Contacts, not typed. */
  function pickInspector(contactId: string) {
    const c = contacts.find((x) => x.id === contactId);
    setForm({ ...form, contact_id: contactId, inspector: c ? (c.name || c.title) : form.inspector });
  }

  async function save() {
    if (!entity || !form.title.trim()) return;
    setSaving(true);
    const attachment_url = file ? await uploadFile('attachments', `${entity.id}/inspections`, file) : null;
    const compound_id = entity.kind === 'compound' ? entity.id : null;
    const building_id = entity.kind === 'building' ? entity.id : (form.scope === 'block' ? form.block_id : null);
    const base: Record<string, unknown> = {
      category: form.category, title: form.title.trim(), contact_id: form.contact_id || null,
      inspection_date: form.inspection_date, status: form.status, outcome: form.outcome.trim() || null,
      next_due_date: form.next_due_date || null, building_id, compound_id,
      amenity_id: form.amenity_id || null,
    };
    // Only overwrite the display text when a contact was actually picked —
    // never blank out a legacy row's inspector just because this save did
    // not touch that field.
    if (form.contact_id) base.inspector = form.inspector.trim();
    if (attachment_url) base.attachment_url = attachment_url;
    const { error } = editId
      ? await supabase.from('inspections').update(base).eq('id', editId)
      : await supabase.from('inspections').insert({ ...base, created_by: profile?.id });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('common.saved'));
    setOpen(false); load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from('inspections').delete().eq('id', id);
    setConfirmDelete(null);
    if (error) { toast.error(error.message); return; }
    load();
  }

  const scopeLabel = (r: Inspection) => r.building_id ? (blockName[r.building_id] ?? t('finance.aBlock')) : (r.compound_id ? t('finance.wholeCompound') : '');

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('inspections.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('inspections.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Entity selection moved to the sidebar (global). Block drill-down stays local. */}
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
          <RadixSelect value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('finance.allTime')}</SelectItem>
              <SelectItem value="year">{t('finance.thisYear')}</SelectItem>
              <SelectItem value="month">{t('reports.specificMonth')}</SelectItem>
            </SelectContent>
          </RadixSelect>
          {period === 'month' && (
            <input
              type="month" value={monthValue} onChange={(e) => setMonthValue(e.target.value)}
              className="rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          )}
          {canManage && entity && <Button variant="tinted" onClick={openNew}><Plus size={16} /> {t('inspections.add')}</Button>}
        </div>
      </div>

      {loading ? <SkeletonCards count={3} />
        : vRows.length === 0 ? (
          <Card><CardBody><div className="text-center py-10">
            <ClipboardCheck className="mx-auto text-primary mb-2" size={28} />
            <p className="text-sm text-muted-foreground">{t('inspections.noInspections')}</p>
          </div></CardBody></Card>
        ) : (
          <div className="space-y-3">
            {vRows.map((r) => (
              <Card key={r.id}><CardBody>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-semibold text-foreground">{r.title}</h3>
                      <Badge color="indigo">{t(`inspections.categories.${r.category}`)}</Badge>
                      <Badge color={statusColor[r.status]}>{t(`inspections.statuses.${r.status}`)}</Badge>
                    </div>
                    {r.outcome && <p className="text-sm text-muted-foreground mb-2">{r.outcome}</p>}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>{fmtDate(r.inspection_date, 'MMM d, yyyy')}</span>
                      {scopeLabel(r) && <><span>•</span><span>{scopeLabel(r)}</span></>}
                      {r.inspector && <><span>•</span><span>{r.inspector}</span></>}
                      {r.next_due_date && <><span>•</span><span>{t('inspections.nextDue')}: {fmtDate(r.next_due_date, 'MMM d, yyyy')}</span></>}
                      {r.attachment_url && <><span>•</span><AttachmentLink url={r.attachment_url} label={t('inspections.viewReport')} className="inline-flex items-center gap-1 text-primary hover:underline" /></>}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"><Pencil size={15} /></button>
                      <button onClick={() => setConfirmDelete(r.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"><Trash2 size={15} /></button>
                    </div>
                  )}
                </div>
              </CardBody></Card>
            ))}
          </div>
        )}

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? t('inspections.edit') : t('inspections.add')} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t('inspections.category')} value={form.category} onValueChange={(v) => setForm({ ...form, category: v as InspectionCategory })}>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{t(`inspections.categories.${c}`)}</SelectItem>)}
            </SelectField>
            <SelectField label={t('inspections.status')} value={form.status} onValueChange={(v) => setForm({ ...form, status: v as InspectionStatus })}>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`inspections.statuses.${s}`)}</SelectItem>)}
            </SelectField>
          </div>
          {/* 0112: which lift, which generator */}
          {amenities.length > 0 && (
            <SelectField label={t('amenities.linkLabel')} value={form.amenity_id || '__none__'} onValueChange={(v) => setForm({ ...form, amenity_id: v === '__none__' ? '' : v })}>
              <SelectItem value="__none__">{t('amenities.linkNone')}</SelectItem>
              {amenities.filter((a) => a.active || a.id === form.amenity_id).map((a) => <SelectItem key={a.id} value={a.id}>{amenityLabel(a)}</SelectItem>)}
            </SelectField>
          )}
          <Input label={t('inspections.inspectionTitle')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          {/* 0123: the inspector/company is picked from Contacts — add it there first. */}
          {contacts.length > 0 ? (
            <SelectField label={t('inspections.inspector')} value={form.contact_id || '__none__'} onValueChange={(v) => pickInspector(v === '__none__' ? '' : v)}>
              <SelectItem value="__none__">—</SelectItem>
              {contacts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name || c.title}</SelectItem>)}
            </SelectField>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-muted-foreground">{t('inspections.inspector')}</label>
              <p className="text-xs text-muted-foreground">
                {t('contracts.noContactsYet')}{' '}
                <Link to="/contacts" className="text-primary hover:underline">{t('contracts.addContactLink')}</Link>
              </p>
            </div>
          )}
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
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('inspections.date')} type="date" value={form.inspection_date} onChange={(e) => setForm({ ...form, inspection_date: e.target.value })} />
            <Input label={t('inspections.nextDue')} type="date" value={form.next_due_date} onChange={(e) => setForm({ ...form, next_due_date: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">{t('inspections.outcome')}</label>
            <textarea className="rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 min-h-[80px]" value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">{t('inspections.attachment')}</label>
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-muted-foreground file:me-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-border file:text-sm file:bg-accent file:text-accent-foreground file:cursor-pointer" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save} loading={saving}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!confirmDelete} onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        title={t('inspections.deleteTitle')} message={t('inspections.deleteConfirm')}
        confirmLabel={t('common.delete')}
      />
    </div>
  );
}
