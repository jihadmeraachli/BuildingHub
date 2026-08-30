import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '@/lib/dateFmt';
import { Plus, FileSignature, Pencil, Trash2, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/upload';
import { AttachmentLink } from '@/components/ui/AttachmentLink';
import { useAuth } from '@/contexts/AuthContext';
import { useViewableBuildings } from '@/lib/useViewableBuildings';
import { useEntities } from '@/lib/entities';
import { useAmenities, amenityLabel } from '@/lib/amenities';
import type { ServiceContract, ServiceType, BillingCycle, BuildingContact } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { fmtMoney } from '@/lib/money';

const SERVICES: ServiceType[] = ['elevator', 'generator', 'landscape', 'security', 'cleaning', 'water', 'internet', 'maintenance', 'other'];
const CYCLES: BillingCycle[] = ['monthly', 'quarterly', 'yearly', 'one_time'];
// one formatter, following the reader's language (src/lib/money.ts)
const money = (n: number) => fmtMoney(n);
type Form = {
  service: ServiceType; service_other: string;
  // 0123: the provider is a contact pick, not free text. provider_name rides
  // along as the denormalized display text — set from the picked contact,
  // or (editing a legacy row with no pick yet) left as whatever it already was.
  contact_id: string; provider_name: string; contact_name: string; contact_phone: string;
  start_date: string; end_date: string; amount: string; billing_cycle: BillingCycle; notes: string;
  scope: 'all' | 'block'; block_id: string;
  amenity_id: string; // 0112: '' = none
};
const newForm = (): Form => ({
  service: 'elevator', service_other: '', contact_id: '', provider_name: '', contact_name: '', contact_phone: '',
  start_date: '', end_date: '', amount: '', billing_cycle: 'monthly', notes: '', scope: 'all', block_id: '', amenity_id: '',
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
  const amenities = useAmenities(entity?.kind, entity?.id); // 0112
  useEffect(() => { setBlockFilter(''); }, [entityKey]);

  // Category + status filters (#51). Status derives from end_date exactly like
  // the card badges: expired = past end, expiring = within 30 days, active =
  // the rest (no end date counts as active).
  const [serviceFilter, setServiceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'expiring' | 'expired'>('');

  const [rows, setRows] = useState<ServiceContract[]>([]);
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
    // too — the provider picker only ever offers contacts in scope.
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
      scoped('service_contracts').order('service'),
      scoped('building_contacts').order('title'),
    ]);
    setRows((data as ServiceContract[]) ?? []);
    setContacts((c as BuildingContact[]) ?? []);
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
      service: r.service, service_other: r.service_other ?? '', contact_id: r.contact_id ?? '',
      provider_name: r.provider_name ?? '', contact_name: r.contact_name ?? '', contact_phone: r.contact_phone ?? '',
      start_date: r.start_date ?? '', end_date: r.end_date ?? '', amount: r.amount_usd != null ? String(r.amount_usd) : '',
      billing_cycle: r.billing_cycle ?? 'monthly', notes: r.notes ?? '', scope: r.building_id ? 'block' : 'all', block_id: r.building_id ?? '',
      amenity_id: r.amenity_id ?? '',
    });
    setOpen(true);
  }

  /** 0123: the provider is picked from Contacts, not typed. A brand-new
   *  contract requires a pick (there is no free text to fall back on); an
   *  edit of a legacy row that predates this may still have no pick — that
   *  is fine, its old provider_name display stays exactly as it was. */
  function pickProvider(contactId: string) {
    const c = contacts.find((x) => x.id === contactId);
    setForm({ ...form, contact_id: contactId, provider_name: c ? (c.name || c.title) : form.provider_name });
  }

  async function save() {
    if (!entity || (!editId && !form.contact_id)) return;
    setSaving(true);
    const attachment_url = file ? await uploadFile('attachments', `${entity.id}/contracts`, file) : null;
    const compound_id = entity.kind === 'compound' ? entity.id : null;
    const building_id = entity.kind === 'building' ? entity.id : (form.scope === 'block' ? form.block_id : null);
    // Sent only when it carries or clears a value, so saves keep working on a
    // DB that has not run 0075 yet.
    const serviceOther = form.service === 'other' ? form.service_other.trim() || null : null;
    const base: Record<string, unknown> = {
      service: form.service,
      contact_id: form.contact_id || null, contact_name: form.contact_name.trim() || null,
      contact_phone: form.contact_phone.trim() || null, start_date: form.start_date || null, end_date: form.end_date || null,
      amount_usd: form.amount ? Number(form.amount) : null, billing_cycle: form.billing_cycle, notes: form.notes.trim() || null,
      building_id, compound_id, amenity_id: form.amenity_id || null,
    };
    // Only overwrite the display text when a contact was actually picked —
    // never blank out a legacy row's provider_name just because this save
    // did not touch the provider field.
    if (form.contact_id) base.provider_name = form.provider_name.trim();
    if (attachment_url) base.attachment_url = attachment_url;
    if (serviceOther !== null || (editId && rows.find((r) => r.id === editId)?.service_other)) base.service_other = serviceOther;
    const { error } = editId
      ? await supabase.from('service_contracts').update(base).eq('id', editId)
      : await supabase.from('service_contracts').insert({ ...base, created_by: profile?.id });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('common.saved'));
    setOpen(false); load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from('service_contracts').delete().eq('id', id);
    setConfirmDelete(null);
    if (error) { toast.error(error.message); return; }
    load();
  }

  // Status is always shown, so an admin sees at a glance what lapsed: a
  // contract flips to Expired on its own the day after end_date.
  function statusBadge(r: ServiceContract) {
    const s = statusOf(r);
    if (s === 'expired') return <Badge color="red">{t('contracts.expired')}</Badge>;
    if (s === 'expiring') return <Badge color="yellow">{t('contracts.expiresSoon')}</Badge>;
    return <Badge color="green">{t('contracts.active')}</Badge>;
  }
  const svcLabel = (r: ServiceContract) =>
    r.service === 'other' && r.service_other ? r.service_other : t(`contracts.services.${r.service}`);
  const scopeLabel = (r: ServiceContract) => r.building_id ? (blockName[r.building_id] ?? t('finance.aBlock')) : (r.compound_id ? t('finance.wholeCompound') : '');

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('contracts.title')}</h1>
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
          {canManage && entity && <Button variant="tinted" onClick={openNew}><Plus size={16} /> {t('contracts.add')}</Button>}
        </div>
      </div>

      {loading ? <SkeletonCards count={3} />
        : vRows.length === 0 ? (
          <Card><CardBody><div className="text-center py-10">
            <FileSignature className="mx-auto text-primary mb-2" size={28} />
            <p className="text-sm text-muted-foreground">{t('contracts.noContracts')}</p>
          </div></CardBody></Card>
        ) : (
          <div className="space-y-3">
            {vRows.map((r) => (
              <Card key={r.id}><CardBody>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-semibold text-foreground">{r.provider_name}</h3>
                      <Badge color="indigo">{svcLabel(r)}</Badge>
                      {statusBadge(r)}
                    </div>
                    {r.notes && <p className="text-sm text-muted-foreground mb-2">{r.notes}</p>}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {r.amount_usd != null && (
                        <span className="text-foreground tnum font-medium">{money(Number(r.amount_usd))}{r.billing_cycle && <span className="text-muted-foreground font-normal"> / {t(`contracts.cycles.${r.billing_cycle}`)}</span>}</span>
                      )}
                      {(r.start_date || r.end_date) && (
                        <><span>•</span><span>{r.start_date ? fmtDate(r.start_date, 'MMM yyyy') : '—'} → {r.end_date ? fmtDate(r.end_date, 'MMM yyyy') : '—'}</span></>
                      )}
                      {scopeLabel(r) && <><span>•</span><span>{scopeLabel(r)}</span></>}
                      {r.contact_name && <><span>•</span><span>{r.contact_name}</span></>}
                      {r.contact_phone && <><span>•</span><span className="inline-flex items-center gap-1"><Phone size={11} /> {r.contact_phone}</span></>}
                      {r.attachment_url && <><span>•</span><AttachmentLink url={r.attachment_url} label={t('contracts.viewDoc')} className="inline-flex items-center gap-1 text-primary hover:underline" /></>}
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

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? t('contracts.edit') : t('contracts.add')} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t('contracts.service')} value={form.service} onValueChange={(v) => setForm({ ...form, service: v as ServiceType })}>
              {SERVICES.map((s) => <SelectItem key={s} value={s}>{t(`contracts.services.${s}`)}</SelectItem>)}
            </SelectField>
            {/* 0123: the provider is picked from Contacts — add it there first. */}
            {contacts.length > 0 ? (
              <SelectField label={t('contracts.provider')} value={form.contact_id || '__none__'} onValueChange={(v) => pickProvider(v === '__none__' ? '' : v)}>
                <SelectItem value="__none__">—</SelectItem>
                {contacts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name || c.title}</SelectItem>)}
              </SelectField>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-muted-foreground">{t('contracts.provider')}</label>
                <p className="text-xs text-muted-foreground">
                  {t('contracts.noContactsYet')}{' '}
                  <Link to="/contacts" className="text-primary hover:underline">{t('contracts.addContactLink')}</Link>
                </p>
              </div>
            )}
          </div>
          {form.service === 'other' && (
            <Input
              label={t('contracts.otherService')}
              placeholder={t('contracts.otherServicePlaceholder')}
              value={form.service_other}
              onChange={(e) => setForm({ ...form, service_other: e.target.value })}
            />
          )}
          {/* 0112: which lift, which generator */}
          {amenities.length > 0 && (
            <SelectField label={t('amenities.linkLabel')} value={form.amenity_id || '__none__'} onValueChange={(v) => setForm({ ...form, amenity_id: v === '__none__' ? '' : v })}>
              <SelectItem value="__none__">{t('amenities.linkNone')}</SelectItem>
              {amenities.filter((a) => a.active || a.id === form.amenity_id).map((a) => <SelectItem key={a.id} value={a.id}>{amenityLabel(a)}</SelectItem>)}
            </SelectField>
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

      <ConfirmModal
        open={!!confirmDelete} onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        title={t('contracts.deleteTitle')} message={t('contracts.deleteConfirm')}
        confirmLabel={t('common.delete')}
      />
    </div>
  );
}
