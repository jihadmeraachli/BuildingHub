import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Plus, ClipboardCheck, Pencil, Trash2, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/upload';
import { useAuth } from '@/contexts/AuthContext';
import { useViewableBuildings } from '@/lib/useViewableBuildings';
import { useEntities } from '@/lib/entities';
import type { Inspection, InspectionCategory, InspectionStatus } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';

const CATEGORIES: InspectionCategory[] = ['generator', 'elevator', 'fire_safety', 'water_tank', 'electrical', 'hvac', 'other'];
const STATUSES: InspectionStatus[] = ['passed', 'failed', 'action_required', 'pending'];
const statusColor: Record<InspectionStatus, 'green' | 'red' | 'yellow' | 'slate'> = { passed: 'green', failed: 'red', action_required: 'yellow', pending: 'slate' };

type Form = {
  category: InspectionCategory; title: string; inspector: string; inspection_date: string;
  status: InspectionStatus; outcome: string; next_due_date: string; scope: 'all' | 'block'; block_id: string;
};
const newForm = (): Form => ({
  category: 'generator', title: '', inspector: '', inspection_date: new Date().toISOString().slice(0, 10),
  status: 'pending', outcome: '', next_due_date: '', scope: 'all', block_id: '',
});

export default function Inspections() {
  const { t } = useTranslation();
  const { can, isPlatformAdmin, profile } = useAuth();
  const { buildings } = useViewableBuildings();
  const entities = useEntities(buildings);
  const [entityKey, setEntityKey] = useState('');
  const [blockFilter, setBlockFilter] = useState('');
  useEffect(() => { if (!entityKey && entities.length) setEntityKey(entities[0].key); }, [entities, entityKey]);
  const entity = entities.find((e) => e.key === entityKey) ?? null;
  useEffect(() => { setBlockFilter(''); }, [entityKey]);

  const [rows, setRows] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(newForm());
  const [file, setFile] = useState<File | null>(null);

  const legacyManager = profile?.role === 'super_admin' || profile?.role === 'building_admin';
  const canManage = isPlatformAdmin || legacyManager || !!entity?.buildingIds.some((id) => can('building.manage', id));
  const multiBlock = (entity?.blocks.length ?? 0) > 1;
  const blockName = Object.fromEntries(buildings.map((b) => [b.id, b.name]));

  useEffect(() => { if (entity) load(); }, [entityKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!entity) return;
    setLoading(true);
    const q = entity.kind === 'compound'
      ? supabase.from('inspections').select('*').or(`compound_id.eq.${entity.id},building_id.in.(${entity.buildingIds.join(',')})`)
      : supabase.from('inspections').select('*').eq('building_id', entity.id);
    const { data } = await q.order('inspection_date', { ascending: false });
    setRows((data as Inspection[]) ?? []);
    setLoading(false);
  }

  const vRows = rows.filter((r) => !blockFilter || r.building_id === blockFilter);

  function openNew() { setEditId(null); setForm(newForm()); setFile(null); setOpen(true); }
  function openEdit(r: Inspection) {
    setEditId(r.id); setFile(null);
    setForm({ category: r.category, title: r.title, inspector: r.inspector ?? '', inspection_date: r.inspection_date, status: r.status, outcome: r.outcome ?? '', next_due_date: r.next_due_date ?? '', scope: r.building_id ? 'block' : 'all', block_id: r.building_id ?? '' });
    setOpen(true);
  }

  async function save() {
    if (!entity || !form.title.trim()) return;
    setSaving(true);
    const attachment_url = file ? await uploadFile('attachments', `${entity.id}/inspections`, file) : null;
    const compound_id = entity.kind === 'compound' ? entity.id : null;
    const building_id = entity.kind === 'building' ? entity.id : (form.scope === 'block' ? form.block_id : null);
    const base: Record<string, unknown> = {
      category: form.category, title: form.title.trim(), inspector: form.inspector.trim() || null,
      inspection_date: form.inspection_date, status: form.status, outcome: form.outcome.trim() || null,
      next_due_date: form.next_due_date || null, building_id, compound_id,
    };
    if (attachment_url) base.attachment_url = attachment_url;
    const { error } = editId
      ? await supabase.from('inspections').update(base).eq('id', editId)
      : await supabase.from('inspections').insert({ ...base, created_by: profile?.id });
    setSaving(false);
    if (error) { alert(error.message); return; }
    setOpen(false); load();
  }

  async function remove(id: string) {
    if (!confirm('Delete this inspection?')) return;
    await supabase.from('inspections').delete().eq('id', id);
    load();
  }

  const scopeLabel = (r: Inspection) => r.building_id ? (blockName[r.building_id] ?? t('finance.aBlock')) : (r.compound_id ? t('finance.wholeCompound') : '');

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('inspections.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('inspections.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {entities.length > 1 && (
            <Select value={entityKey} onChange={(e) => setEntityKey(e.target.value)} className="min-w-[180px]">
              {entities.map((e) => <option key={e.key} value={e.key}>{e.kind === 'compound' ? `▣ ${e.name}` : e.name}</option>)}
            </Select>
          )}
          {entity?.kind === 'compound' && multiBlock && (
            <Select value={blockFilter} onChange={(e) => setBlockFilter(e.target.value)}>
              <option value="">{t('finance.allBlocks')}</option>
              {entity.blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
          {canManage && entity && <Button onClick={openNew}><Plus size={16} /> {t('inspections.add')}</Button>}
        </div>
      </div>

      {loading ? <p className="text-sm text-slate-500">{t('common.loading')}</p>
        : vRows.length === 0 ? (
          <Card><CardBody><div className="text-center py-10">
            <ClipboardCheck className="mx-auto text-slate-300 mb-2" size={28} />
            <p className="text-sm text-slate-500">{t('inspections.noInspections')}</p>
          </div></CardBody></Card>
        ) : (
          <div className="space-y-3">
            {vRows.map((r) => (
              <Card key={r.id}><CardBody>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-semibold text-slate-900">{r.title}</h3>
                      <Badge color="indigo">{t(`inspections.categories.${r.category}`)}</Badge>
                      <Badge color={statusColor[r.status]}>{t(`inspections.statuses.${r.status}`)}</Badge>
                    </div>
                    {r.outcome && <p className="text-sm text-slate-600 mb-2">{r.outcome}</p>}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span>{format(new Date(r.inspection_date), 'MMM d, yyyy')}</span>
                      {scopeLabel(r) && <><span>•</span><span>{scopeLabel(r)}</span></>}
                      {r.inspector && <><span>•</span><span>{r.inspector}</span></>}
                      {r.next_due_date && <><span>•</span><span>{t('inspections.nextDue')}: {format(new Date(r.next_due_date), 'MMM d, yyyy')}</span></>}
                      {r.attachment_url && <><span>•</span><a href={r.attachment_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline"><FileText size={12} /> {t('inspections.viewReport')}</a></>}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"><Pencil size={15} /></button>
                      <button onClick={() => remove(r.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"><Trash2 size={15} /></button>
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
            <Select label={t('inspections.category')} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as InspectionCategory })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`inspections.categories.${c}`)}</option>)}
            </Select>
            <Select label={t('inspections.status')} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as InspectionStatus })}>
              {STATUSES.map((s) => <option key={s} value={s}>{t(`inspections.statuses.${s}`)}</option>)}
            </Select>
          </div>
          <Input label={t('inspections.inspectionTitle')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Input label={t('inspections.inspector')} value={form.inspector} onChange={(e) => setForm({ ...form, inspector: e.target.value })} />
          {entity?.kind === 'compound' && (
            <div className="grid grid-cols-2 gap-3">
              <Select label={t('finance.applyTo')} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as 'all' | 'block' })}>
                <option value="all">{t('finance.wholeCompound')}</option>
                <option value="block">{t('finance.aBlock')}</option>
              </Select>
              {form.scope === 'block' && (
                <Select label={t('finance.block')} value={form.block_id} onChange={(e) => setForm({ ...form, block_id: e.target.value })}>
                  <option value="">—</option>
                  {entity.blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('inspections.date')} type="date" value={form.inspection_date} onChange={(e) => setForm({ ...form, inspection_date: e.target.value })} />
            <Input label={t('inspections.nextDue')} type="date" value={form.next_due_date} onChange={(e) => setForm({ ...form, next_due_date: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-600">{t('inspections.outcome')}</label>
            <textarea className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 min-h-[80px]" value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-600">{t('inspections.attachment')}</label>
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-slate-600 file:me-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-slate-200 file:text-sm file:bg-white file:cursor-pointer" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save} loading={saving}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
