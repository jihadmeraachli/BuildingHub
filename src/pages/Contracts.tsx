import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '@/lib/dateFmt';
import { Plus, FileSignature, Pencil, Trash2, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/upload';
import { AttachmentLink } from '@/components/ui/AttachmentLink';
import { useAuth } from '@/contexts/AuthContext';
import { useViewableBuildings } from '@/lib/useViewableBuildings';
import { useEntities } from '@/lib/entities';
import type { ServiceContract, ServiceType, BillingCycle } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { PhoneInput } from '@/components/ui/PhoneInput';
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
  // GLOBAL entity selection (sidebar); '' = view across all viewable buildings
  // (adding a contract still needs a specific entity picked).
  const { entityKey } = useAuth();
  const [blockFilter, setBlockFilter] = useState('');
  const entity = entities.find((e) => e.key === entityKey) ?? null;
  useEffect(() => { setBlockFilter(''); }, [entityKey]);

  // Category + status filters (#51). Status derives from end_date exactly like
  // the card badges: expired = past end, expiring = within 30 days, active =
  // the rest (no end date counts as active).
  const [serviceFilter, setServiceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'expiring' | 'expired'>('');

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

  useEffect(() => { if (entity || buildings.length) load(); }, [entityKey, buildings.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!entity && !buildings.length) return;
    setLoading(true);
    let q;
    if (entity) {
      q = entity.kind === 'compound'
        ? supabase.from('service_contracts').select('*').or(`compound_id.eq.${entity.id},building_id.in.(${entity.buildingIds.join(',')})`)
        : supabase.from('service_contracts').select('*').eq('building_id', entity.id);
    } else {
      // "All buildings": every block + every compound the user can see
      const bIds = buildings.map((b) => b.id).join(',');
      const cIds = entities.filter((e) => e.kind === 'compound').map((e) => e.id).join(',');
      q = cIds
        ? supabase.from('service_contracts').select('*').or(`compound_id.in.(${cIds}),building_id.in.(${bIds})`)
        : supabase.from('service_contracts').select('*').in('building_id', buildings.map((b) => b.id));
    }
    const { data } = await q.order('service');
    setRows((data as ServiceContract[]) ?? []);
    setLoading(false);
  }

  const statusOf = (r: ServiceContract): 'active' | 'expiring' | 'expired' => {
    if (!r.end_date) return 'active';
    const days = Math.ceil((new Date(r.end_date).getTime() - Date.now()) / 86400000);
    return days < 0 ? 'expired' : days <= 30 ? 'expiring' : 'active';
  };
  const vRows = rows.filter((r) =>
    (!blockFilter || r.building_id === blockFilter)
    && (!serviceFilter || r.service === serviceFilter)
    && (!statusFilter || statusOf(r) === statusFilter));

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
          <p className="text-sm text-muted-foreground mt-0.5">{t('contracts.subtitle')}</p>
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
          <RadixSelect value={serviceFilter || '__all__'} onValueChange={(v) => setServiceFilter(v === '__all__' ? '' : v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('contracts.allServices')}</SelectItem>
              {SERVICES.map((s) => <SelectItem key={s} value={s}>{t(`contracts.services.${s}`)}</SelectItem>)}
            </SelectContent>
          </RadixSelect>
          <RadixSelect value={statusFilter || '__all__'} onValueChange={(v) => setStatusFilter(v === '__all__' ? '' : v as 'active' | 'expiring' | 'expired')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('contracts.allStatuses')}</SelectItem>
              <SelectItem value="active">{t('contracts.active')}</SelectItem>
              <SelectItem value="expiring">{t('contracts.expiresSoon')}</SelectItem>
              <SelectItem value="expired">{t('contracts.expired')}</SelectItem>
            </SelectContent>
          </RadixSelect>
          {canManage && entity && <Button onClick={openNew}><Plus size={16} /> {t('contracts.add')}</Button>}
        </div>
      </div>

      {loading ? <SkeletonCards count={3} />
        : vRows.length === 0 ? (
          <Card><CardBody><div className="text-center py-10">
            <FileSignature className="mx-auto text-primary mb-2" size={28} />
            <p className="text-sm text-muted-foreground">{t('contracts.noContracts')}</p>
          </div></CardBody></Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vRows.map((r) => (
              <Card key={r.id}><CardBody>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Badge color="indigo">{t(`contracts.services.${r.service}`)}</Badge>
                    <h3 className="font-semibold text-foreground mt-2">{r.provider_name}</h3>
                    {scopeLabel(r) && <p className="text-[11px] text-muted-foreground mt-0.5">{scopeLabel(r)}</p>}
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"><Pencil size={14} /></button>
                      <button onClick={() => remove(r.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
                {r.contact_name && <p className="text-sm text-muted-foreground mt-2">{r.contact_name}</p>}
                {r.contact_phone && <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone size={11} /> {r.contact_phone}</p>}
                <div className="mt-3 pt-3 border-t border-border space-y-1 text-sm">
                  {r.amount_usd != null && (
                    <p className="text-foreground tnum font-medium">{money(Number(r.amount_usd))}{r.billing_cycle && <span className="text-muted-foreground text-xs font-normal"> / {t(`contracts.cycles.${r.billing_cycle}`)}</span>}</p>
                  )}
                  {(r.start_date || r.end_date) && (
                    <p className="text-xs text-muted-foreground flex items-center gap-2">
                      {r.start_date ? fmtDate(r.start_date, 'MMM yyyy') : '—'} → {r.end_date ? fmtDate(r.end_date, 'MMM yyyy') : '—'}
                      {expiryBadge(r.end_date)}
                    </p>
                  )}
                  {r.notes && <p className="text-xs text-muted-foreground">{r.notes}</p>}
                  {r.attachment_url && <AttachmentLink url={r.attachment_url} label={t('contracts.viewDoc')} className="inline-flex items-center gap-1 text-xs text-primary hover:underline pt-1" />}
                </div>
              </CardBody></Card>
            ))}
          </div>
        )}

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? t('contracts.edit') : t('contracts.add')} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t('contracts.service')} value={form.service} onValueChange={(v) => setForm({ ...form, service: v as ServiceType })}>
              {SERVICES.map((s) => <SelectItem key={s} value={s}>{t(`contracts.services.${s}`)}</SelectItem>)}
            </SelectField>
            <Input label={t('contracts.provider')} value={form.provider_name} onChange={(e) => setForm({ ...form, provider_name: e.target.value })} />
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
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('contracts.contactName')} value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
            <PhoneInput label={t('contracts.contactPhone')} value={form.contact_phone} onChange={(v) => setForm({ ...form, contact_phone: v })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('contracts.startDate')} type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            <Input label={t('contracts.endDate')} type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('contracts.amount')} type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <SelectField label={t('contracts.cycle')} value={form.billing_cycle} onValueChange={(v) => setForm({ ...form, billing_cycle: v as BillingCycle })}>
              {CYCLES.map((c) => <SelectItem key={c} value={c}>{t(`contracts.cycles.${c}`)}</SelectItem>)}
            </SelectField>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">{t('contracts.notes')}</label>
            <textarea className="rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 min-h-[70px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">{t('contracts.attachment')}</label>
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-muted-foreground file:me-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-border file:text-sm file:bg-accent file:text-accent-foreground file:cursor-pointer" />
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
