import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '@/lib/dateFmt';
import { Plus, ClipboardCheck, Pencil, Trash2, FolderCog, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/upload';
import { AttachmentLink } from '@/components/ui/AttachmentLink';
import { useAuth } from '@/contexts/AuthContext';
import { useViewableBuildings } from '@/lib/useViewableBuildings';
import { useEntities } from '@/lib/entities';
import { useAmenities, amenityLabel } from '@/lib/amenities';
import type { Inspection, InspectionCategory, InspectionCategoryRow, InspectionStatus, BuildingContact } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { SkeletonCards } from '@/components/ui/Skeleton';

// Statuses an admin RECORDS. 'due' is system-made (0165 chain): it appears
// on auto-created rows and in their edit form, but is never picked manually.
const STATUSES: InspectionStatus[] = ['passed', 'failed', 'action_required', 'pending'];
const statusColor: Record<InspectionStatus, 'green' | 'red' | 'yellow' | 'slate'> = { passed: 'green', failed: 'red', action_required: 'yellow', pending: 'slate', due: 'yellow' };
const today = () => new Date().toISOString().slice(0, 10);

type Form = {
  // 0165: category_id = user-created category. `category` (legacy enum) rides
  // along untouched on old rows; new rows store 'other' to satisfy the CHECK.
  category: InspectionCategory; category_id: string; title: string; contact_id: string; inspector: string;
  inspection_date: string; status: InspectionStatus; outcome: string; next_due_date: string;
  scope: 'all' | 'block'; block_id: string;
  amenity_id: string; // 0112: '' = none
};
const newForm = (): Form => ({
  category: 'other', category_id: '', title: '', contact_id: '', inspector: '', inspection_date: today(),
  status: 'pending', outcome: '', next_due_date: '', scope: 'all', block_id: '', amenity_id: '',
});

export default function Inspections() {
  const { t } = useTranslation();
  const { can, isPlatformAdmin, profile } = useAuth();
  const { buildings } = useViewableBuildings();
  const entities = useEntities(buildings);
  const { entityKey } = useAuth();
  const [blockFilter, setBlockFilter] = useState('');
  const entity = entities.find((e) => e.key === entityKey) ?? null;
  const amenities = useAmenities(entity?.kind, entity?.id); // 0112
  useEffect(() => { setBlockFilter(''); }, [entityKey]);

  const [period, setPeriod] = useState<'all' | 'year' | 'month'>('all');
  const [monthValue, setMonthValue] = useState(() => new Date().toISOString().slice(0, 7));

  const [rows, setRows] = useState<Inspection[]>([]);
  const [cats, setCats] = useState<InspectionCategoryRow[]>([]);
  const [contacts, setContacts] = useState<BuildingContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editingDue, setEditingDue] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(newForm());
  const [file, setFile] = useState<File | null>(null);

  // category manager (0165)
  const [catsOpen, setCatsOpen] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [catBusy, setCatBusy] = useState(false);
  const [confirmCatDelete, setConfirmCatDelete] = useState<string | null>(null);

  // collapsible category sections - persisted like the sidebar menu
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('abniyah_inspections_collapsed') || '{}'); } catch { return {}; }
  });
  const toggleGroup = (k: string) => {
    const next = { ...collapsed, [k]: !collapsed[k] };
    setCollapsed(next);
    try { localStorage.setItem('abniyah_inspections_collapsed', JSON.stringify(next)); } catch { /* private mode */ }
  };

  const canManage = isPlatformAdmin || !!entity?.buildingIds.some((id) => can('building.manage', id));
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
    const [{ data }, { data: c }, { data: ic }] = await Promise.all([
      scoped('inspections').order('inspection_date', { ascending: false }),
      scoped('building_contacts').order('title'),
      scoped('inspection_categories').order('name'),
    ]);
    setRows((data as Inspection[]) ?? []);
    setContacts((c as BuildingContact[]) ?? []);
    setCats((ic as InspectionCategoryRow[]) ?? []);
    setLoading(false);
  }

  const inPeriod = (d: string) =>
    period === 'all' ? true
    : period === 'year' ? new Date(d).getFullYear() === new Date().getFullYear()
    : d.startsWith(monthValue);
  const vRows = rows.filter((r) => (!blockFilter || r.building_id === blockFilter) && inPeriod(r.inspection_date));

  // ── grouping (0165): user categories first (alphabetical), then legacy
  //    enum groups for old rows, then uncategorized ────────────────────────
  const catName = Object.fromEntries(cats.map((c) => [c.id, c.name]));
  const groupKey = (r: Inspection) => r.category_id && catName[r.category_id] ? `c:${r.category_id}` : (r.category && r.category !== 'other' ? `l:${r.category}` : 'u');
  const groupLabel = (k: string) =>
    k.startsWith('c:') ? catName[k.slice(2)]
    : k.startsWith('l:') ? t(`inspections.categories.${k.slice(2)}`)
    : t('inspections.uncategorized');
  const groups = [...new Set(vRows.map(groupKey))].sort((a, b) => {
    const rank = (k: string) => (k.startsWith('c:') ? 0 : k.startsWith('l:') ? 1 : 2);
    return rank(a) - rank(b) || String(groupLabel(a)).localeCompare(String(groupLabel(b)));
  });

  function openNew() { setEditId(null); setEditingDue(false); setForm({ ...newForm(), category_id: cats[0]?.id ?? '' }); setFile(null); setOpen(true); }
  function openEdit(r: Inspection) {
    setEditId(r.id); setFile(null);
    setEditingDue(r.status === 'due');
    setForm({
      category: r.category, category_id: r.category_id ?? '', title: r.title, contact_id: r.contact_id ?? '',
      inspector: r.inspector ?? '', inspection_date: r.inspection_date,
      // opening a due record is the "record it now" moment: propose Passed
      status: r.status === 'due' ? 'passed' : r.status,
      outcome: r.outcome ?? '', next_due_date: r.next_due_date ?? '',
      scope: r.building_id ? 'block' : 'all', block_id: r.building_id ?? '', amenity_id: r.amenity_id ?? '',
    });
    setOpen(true);
  }

  /** 0123: the inspector/company is picked from Contacts, not typed. */
  function pickInspector(contactId: string) {
    const c = contacts.find((x) => x.id === contactId);
    setForm({ ...form, contact_id: contactId, inspector: c ? (c.name || c.title) : form.inspector });
  }

  async function save() {
    if (!entity || !form.title.trim()) return;
    if (!editId && !form.category_id) { toast.error(t('inspections.pickCategory')); return; }
    setSaving(true);
    const attachment_url = file ? await uploadFile('attachments', `${entity.id}/inspections`, file) : null;
    const compound_id = entity.kind === 'compound' ? entity.id : null;
    const building_id = entity.kind === 'building' ? entity.id : (form.scope === 'block' ? form.block_id : null);
    const base: Record<string, unknown> = {
      category: form.category, category_id: form.category_id || null, title: form.title.trim(),
      contact_id: form.contact_id || null,
      inspection_date: form.inspection_date, status: form.status, outcome: form.outcome.trim() || null,
      next_due_date: form.next_due_date || null, building_id, compound_id,
      amenity_id: form.amenity_id || null,
    };
    if (form.contact_id) base.inspector = form.inspector.trim();
    if (attachment_url) base.attachment_url = attachment_url;
    const { error } = editId
      ? await supabase.from('inspections').update(base).eq('id', editId)
      : await supabase.from('inspections').insert({ ...base, created_by: profile?.id });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    // the 0165 chain trigger creates/moves the next 'due' record server-side
    toast.success(form.next_due_date ? t('inspections.savedChained', { date: fmtDate(form.next_due_date, 'dd-MM-yyyy') }) : t('common.saved'));
    setOpen(false); load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from('inspections').delete().eq('id', id);
    setConfirmDelete(null);
    if (error) { toast.error(error.message); return; }
    load();
  }

  async function addCategory() {
    if (!entity || !newCat.trim()) return;
    setCatBusy(true);
    const { error } = await supabase.from('inspection_categories').insert({
      building_id: entity.kind === 'building' ? entity.id : null,
      compound_id: entity.kind === 'compound' ? entity.id : null,
      name: newCat.trim(), created_by: profile?.id,
    });
    setCatBusy(false);
    if (error) { toast.error(error.message); return; }
    setNewCat(''); load();
  }

  async function removeCategory(id: string) {
    const { error } = await supabase.from('inspection_categories').delete().eq('id', id);
    setConfirmCatDelete(null);
    if (error) { toast.error(error.message); return; }
    load();
  }

  const scopeLabel = (r: Inspection) => r.building_id ? (blockName[r.building_id] ?? t('finance.aBlock')) : (r.compound_id ? t('finance.wholeCompound') : '');
  const isOverdue = (r: Inspection) => r.status === 'due' && r.inspection_date < today();

  const renderCard = (r: Inspection) => (
    <Card key={r.id} className={`${canManage ? 'cursor-pointer hover:bg-primary/5 transition-colors ' : ''}${r.status === 'due' ? 'border-amber-500/40' : ''}`} onClick={() => canManage && openEdit(r)}><CardBody>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="font-semibold text-foreground">{r.title}</h3>
            {isOverdue(r)
              ? <Badge color="red">{t('inspections.overdue')}</Badge>
              : <Badge color={statusColor[r.status]}>{t(`inspections.statuses.${r.status}`)}</Badge>}
          </div>
          {r.outcome && <p className="text-sm text-muted-foreground mb-2">{r.outcome}</p>}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground [&>*+*]:before:content-['•'] [&>*+*]:before:me-2 [&>*+*]:before:text-muted-foreground/50">
            <span>{r.status === 'due' ? `${t('inspections.nextDue')}: ` : ''}{fmtDate(r.inspection_date, 'dd-MM-yyyy')}</span>
            {scopeLabel(r) && <span>{scopeLabel(r)}</span>}
            {r.inspector && <span>{r.inspector}</span>}
            {r.status !== 'due' && r.next_due_date && <span>{t('inspections.nextDue')}: {fmtDate(r.next_due_date, 'dd-MM-yyyy')}</span>}
            {r.attachment_url && <AttachmentLink url={r.attachment_url} label={t('inspections.viewReport')} className="inline-flex items-center gap-1 text-primary hover:underline" />}
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            {r.status === 'due'
              ? <Button size="sm" variant="tinted" onClick={() => openEdit(r)}>{t('inspections.recordNow')}</Button>
              : <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"><Pencil size={15} /></button>}
            <button onClick={() => setConfirmDelete(r.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"><Trash2 size={15} /></button>
          </div>
        )}
      </div>
    </CardBody></Card>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('inspections.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('inspections.subtitle')}</p>
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
          {canManage && entity && <Button variant="ghost" onClick={() => setCatsOpen(true)}><FolderCog size={15} /> {t('inspections.categoriesBtn')}</Button>}
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
          <div className="space-y-6">
            {groups.map((g) => {
              const list = vRows.filter((r) => groupKey(r) === g);
              const due = list.filter((r) => r.status === 'due');
              return (
                <section key={g}>
                  <button type="button" onClick={() => toggleGroup(g)}
                    className="group w-full flex items-center gap-2 mb-2 cursor-pointer">
                    <ChevronDown size={14} className={`shrink-0 text-muted-foreground/50 transition-transform group-hover:text-muted-foreground ${collapsed[g] ? '-rotate-90 rtl:rotate-90' : ''}`} />
                    <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">{groupLabel(g)}</h2>
                    <span className="text-xs text-muted-foreground">{list.length}</span>
                    {due.length > 0 && <Badge color={due.some(isOverdue) ? 'red' : 'yellow'}>{due.some(isOverdue) ? t('inspections.overdue') : t('inspections.statuses.due')}</Badge>}
                  </button>
                  {!collapsed[g] && <div className="space-y-3">{list.map(renderCard)}</div>}
                </section>
              );
            })}
          </div>
        )}

      <Modal open={open} onClose={() => setOpen(false)} title={editingDue ? t('inspections.recordTitle') : editId ? t('inspections.edit') : t('inspections.add')} size="lg">
        <div className="space-y-4">
          {editingDue && <p className="text-sm text-muted-foreground -mb-1">{t('inspections.recordIntro')}</p>}
          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t('inspections.category')} value={form.category_id || '__none__'} onValueChange={(v) => setForm({ ...form, category_id: v === '__none__' ? '' : v })}>
              {!form.category_id && <SelectItem value="__none__">—</SelectItem>}
              {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectField>
            <SelectField label={t('inspections.status')} value={form.status} onValueChange={(v) => setForm({ ...form, status: v as InspectionStatus })}>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`inspections.statuses.${s}`)}</SelectItem>)}
            </SelectField>
          </div>
          {cats.length === 0 && (
            <p className="text-xs text-muted-foreground -mt-2">
              {t('inspections.needCategory')}{' '}
              <button type="button" className="text-primary hover:underline cursor-pointer" onClick={() => setCatsOpen(true)}>{t('inspections.categoriesBtn')}</button>
            </p>
          )}
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
          <p className="text-xs text-muted-foreground -mt-2">{t('inspections.chainHint')}</p>
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

      {/* ── category manager (0165) ── */}
      <Modal open={catsOpen} onClose={() => setCatsOpen(false)} title={t('inspections.catTitle')} size="md">
        <div className="space-y-4">
          {cats.length === 0
            ? <p className="text-sm text-muted-foreground">{t('inspections.catNone')}</p>
            : (
              <div className="space-y-2">
                {cats.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-2.5">
                    <span className="text-sm text-foreground">{c.name}</span>
                    <button onClick={() => setConfirmCatDelete(c.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 cursor-pointer"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input label={t('inspections.catName')} value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder={t('inspections.catPlaceholder')} />
            </div>
            <Button onClick={addCategory} loading={catBusy} disabled={!newCat.trim()}><Plus size={15} /> {t('inspections.catAdd')}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!confirmDelete} onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        title={t('inspections.deleteTitle')} message={t('inspections.deleteConfirm')}
        confirmLabel={t('common.delete')}
      />
      <ConfirmModal
        open={!!confirmCatDelete} onClose={() => setConfirmCatDelete(null)}
        onConfirm={() => confirmCatDelete && removeCategory(confirmCatDelete)}
        title={t('inspections.catDeleteTitle')} message={t('inspections.catDeleteConfirm')}
        confirmLabel={t('common.delete')}
      />
    </div>
  );
}
