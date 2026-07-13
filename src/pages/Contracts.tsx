import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Plus, FileSignature, Pencil, Trash2, FileText, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/upload';
import { useAuth } from '@/contexts/AuthContext';
import { useViewableBuildings } from '@/lib/useViewableBuildings';
import { useEntities } from '@/lib/entities';
import type { ServiceContract, ServiceType, BillingCycle } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { SkeletonCards } from '@/components/ui/Skeleton';

const SERVICES: ServiceType[] = ['elevator', 'generator', 'landscape', 'security', 'cleaning', 'water', 'internet', 'other'];
const CYCLES: BillingCycle[] = ['monthly', 'quarterly', 'yearly', 'one_time'];
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Form = {
  service: ServiceType; provider_name: string; contact_name: string; contact_phone: string;
  start_date: string; end_date: string; amount: string; billing_cycle: BillingCycle; notes: string;
  scope: 'all' | 'block'; block_id: string;
};
const newForm = (): Form => ({
  service: 'elevator', provider_name: '', contact_name: '', contact_phone: '',
  start_date: '', end_date: '', amount: '', billing_cycle: 'monthly', notes: '', scope: 'all', block_id: '',
});

export default function Contracts() {
  const { t } = useTranslation();
  const { can, isPlatformAdmin, profile } = useAuth();
  const { buildings } = useViewableBuildings();
  const entities = useEntities(buildings);
  const [entityKey, setEntityKey] = useState('');
  const [blockFilter, setBlockFilter] = useState('');
  useEffect(() => { if (!entityKey && entities.length) setEntityKey(entities[0].key); }, [entities, entityKey]);
  const entity = entities.find((e) => e.key === entityKey) ?? null;
  useEffect(() => { setBlockFilter(''); }, [entityKey]);

  const [rows, setRows] = useState<ServiceContract[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(newForm());
  const [file, setFile] = useState<File | null>(null);

  const canManage = isPlatformAdmin || !!entity?.buildingIds.some((id) => can('building.manage', id));
  const multiBlock = (entity?.blocks.length ?? 0) > 1;
  const blockName = Object.fromEntries(buildings.map((b) => [b.id, b.name]));

  useEffect(() => { if (entity) load(); }, [entityKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!entity) return;
    setLoading(true);
    const q = entity.kind === 'compound'
      ? supabase.from('service_contracts').select('*').or(`compound_id.eq.${entity.id},building_id.in.(${entity.buildingIds.join(',')})`)
      : supabase.from('service_contracts').select('*').eq('building_id', entity.id);
    const { data } = await q.order('service');
    setRows((data as ServiceContract[]) ?? []);
    setLoading(false);
  }

  const vRows = rows.filter((r) => !blockFilter || r.building_id === blockFilter);

  function openNew() { setEditId(null); setForm(newForm()); setFile(null); setOpen(true); }
  function openEdit(r: ServiceContract) {
    setEditId(r.id); setFile(null);
    setForm({
      service: r.service, provider_name: r.provider_name, contact_name: r.contact_name ?? '', contact_phone: r.contact_phone ?? '',
      start_date: r.start_date ?? '', end_date: r.end_date ?? '', amount: r.amount_usd != null ? String(r.amount_usd) : '',
      billing_cycle: r.billing_cycle ?? 'monthly', notes: r.notes ?? '', scope: r.building_id ? 'block' : 'all', block_id: r.building_id ?? '',
    });
    setOpen(true);
  }

  async function save() {
    if (!entity || !form.provider_name.trim()) return;
    setSaving(true);
    const attachment_url = file ? await uploadFile('attachments', `${entity.id}/contracts`, file) : null;
    const compound_id = entity.kind === 'compound' ? entity.id : null;
    const building_id = entity.kind === 'building' ? entity.id : (form.scope === 'block' ? form.block_id : null);
    const base: Record<string, unknown> = {
      service: form.service, provider_name: form.provider_name.trim(), contact_name: form.contact_name.trim() || null,
      contact_phone: form.contact_phone.trim() || null, start_date: form.start_date || null, end_date: form.end_date || null,
      amount_usd: form.amount ? Number(form.amount) : null, billing_cycle: form.billing_cycle, notes: form.notes.trim() || null,
      building_id, compound_id,
    };
    if (attachment_url) base.attachment_url = attachment_url;
    const { error } = editId
      ? await supabase.from('service_contracts').update(base).eq('id', editId)
      : await supabase.from('service_contracts').insert({ ...base, created_by: profile?.id });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('common.saved'));
    setOpen(false); load();
  }

  async function remove(id: string) {
    if (!confirm('Delete this contract?')) return;
    await supabase.from('service_contracts').delete().eq('id', id);
    load();
  }

  function expiryBadge(end: string | null) {
    if (!end) return null;
    const days = Math.ceil((new Date(end).getTime() - Date.now()) / 86400000);
    if (days < 0) return <Badge color="red">{t('contracts.expired')}</Badge>;
    if (days <= 30) return <Badge color="yellow">{t('contracts.expiresSoon')}</Badge>;
    return null;
  }
  const scopeLabel = (r: ServiceContract) => r.building_id ? (blockName[r.building_id] ?? t('finance.aBlock')) : (r.compound_id ? t('finance.wholeCompound') : '');

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('contracts.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('contracts.subtitle')}</p>
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
          {canManage && entity && <Button onClick={openNew}><Plus size={16} /> {t('contracts.add')}</Button>}
        </div>
      </div>

      {loading ? <SkeletonCards count={3} />
        : vRows.length === 0 ? (
          <Card><CardBody><div className="text-center py-10">
            <FileSignature className="mx-auto text-slate-300 mb-2" size={28} />
            <p className="text-sm text-slate-500">{t('contracts.noContracts')}</p>
          </div></CardBody></Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vRows.map((r) => (
              <Card key={r.id}><CardBody>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Badge color="indigo">{t(`contracts.services.${r.service}`)}</Badge>
                    <h3 className="font-semibold text-slate-900 mt-2">{r.provider_name}</h3>
                    {scopeLabel(r) && <p className="text-[11px] text-slate-400 mt-0.5">{scopeLabel(r)}</p>}
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"><Pencil size={14} /></button>
                      <button onClick={() => remove(r.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
                {r.contact_name && <p className="text-sm text-slate-500 mt-2">{r.contact_name}</p>}
                {r.contact_phone && <p className="text-xs text-slate-400 flex items-center gap-1"><Phone size={11} /> {r.contact_phone}</p>}
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-1 text-sm">
                  {r.amount_usd != null && (
                    <p className="text-slate-700 tnum font-medium">{money(Number(r.amount_usd))}{r.billing_cycle && <span className="text-slate-400 text-xs font-normal"> / {t(`contracts.cycles.${r.billing_cycle}`)}</span>}</p>
                  )}
                  {(r.start_date || r.end_date) && (
                    <p className="text-xs text-slate-500 flex items-center gap-2">
                      {r.start_date ? format(new Date(r.start_date), 'MMM yyyy') : '—'} → {r.end_date ? format(new Date(r.end_date), 'MMM yyyy') : '—'}
                      {expiryBadge(r.end_date)}
                    </p>
                  )}
                  {r.notes && <p className="text-xs text-slate-500">{r.notes}</p>}
                  {r.attachment_url && <a href={r.attachment_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline pt-1"><FileText size={12} /> {t('contracts.viewDoc')}</a>}
                </div>
              </CardBody></Card>
            ))}
          </div>
        )}

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? t('contracts.edit') : t('contracts.add')} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Select label={t('contracts.service')} value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value as ServiceType })}>
              {SERVICES.map((s) => <option key={s} value={s}>{t(`contracts.services.${s}`)}</option>)}
            </Select>
            <Input label={t('contracts.provider')} value={form.provider_name} onChange={(e) => setForm({ ...form, provider_name: e.target.value })} />
          </div>
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
            <Input label={t('contracts.contactName')} value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
            <Input label={t('contracts.contactPhone')} value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('contracts.startDate')} type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            <Input label={t('contracts.endDate')} type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('contracts.amount')} type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <Select label={t('contracts.cycle')} value={form.billing_cycle} onChange={(e) => setForm({ ...form, billing_cycle: e.target.value as BillingCycle })}>
              {CYCLES.map((c) => <option key={c} value={c}>{t(`contracts.cycles.${c}`)}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-600">{t('contracts.notes')}</label>
            <textarea className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 min-h-[70px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-600">{t('contracts.attachment')}</label>
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
