import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '@/lib/dateFmt';
import { Plus, Cog, Pencil, Trash2, FileSignature, ClipboardCheck, Receipt, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/upload';
import { AttachmentLink } from '@/components/ui/AttachmentLink';
import { useAuth } from '@/contexts/AuthContext';
import { useViewableBuildings } from '@/lib/useViewableBuildings';
import { useEntities } from '@/lib/entities';
import { fmtMoney } from '@/lib/money';
import type { Amenity, AmenityKind } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { SkeletonCards } from '@/components/ui/Skeleton';

/**
 * Amenities (0112) — the building's inventory: one row per lift, generator,
 * tank, gate. Contracts, inspections, expenses and issues hang off a row, so
 * "everything about the generator" is one click. Cost + install date +
 * expected life give replacement planning without a second screen.
 * Residents see this read-only.
 */
const KINDS: AmenityKind[] = ['elevator', 'generator', 'water_tank', 'water_pump', 'solar', 'hvac', 'fire_safety', 'gate', 'intercom', 'parking', 'storage', 'roof', 'other'];
const money = (n: number) => fmtMoney(n);

type Form = { kind: AmenityKind; name: string; location: string; install_date: string; cost: string; life: string; notes: string; active: boolean; scope: 'all' | 'block'; block_id: string };
const newForm = (): Form => ({ kind: 'elevator', name: '', location: '', install_date: '', cost: '', life: '', notes: '', active: true, scope: 'all', block_id: '' });

type Linked = {
  contracts: { id: string; provider_name: string; end_date: string | null; amount_usd: number | null }[];
  inspections: { id: string; title: string; inspection_date: string; status: string; next_due_date: string | null }[];
  expenses: { id: string; description: string; expense_date: string; amount_usd: number }[];
  issues: { id: string; title: string; status: string; created_at: string }[];
};

export default function Amenities() {
  const { t } = useTranslation();
  const { can, isPlatformAdmin, profile } = useAuth();
  const { buildings } = useViewableBuildings();
  const entities = useEntities(buildings);
  const { entityKey } = useAuth();
  const entity = entities.find((e) => e.key === entityKey) ?? null;

  const [kindFilter, setKindFilter] = useState<'' | AmenityKind>('');
  const [rows, setRows] = useState<Amenity[]>([]);
  const [counts, setCounts] = useState<Record<string, { c: number; i: number; e: number; s: number }>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(newForm());
  const [file, setFile] = useState<File | null>(null);
  const [detail, setDetail] = useState<Amenity | null>(null);
  const [linked, setLinked] = useState<Linked | null>(null);

  const canManage = isPlatformAdmin || !!entity?.buildingIds.some((id) => can('building.manage', id));
  const multiBlock = (entity?.blocks.length ?? 0) > 1;
  const blockName = Object.fromEntries(buildings.map((b) => [b.id, b.name]));

  useEffect(() => { if (entity || buildings.length) load(); }, [entityKey, buildings.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!entity && !buildings.length) return;
    setLoading(true);
    const bIds = (entity ? entity.buildingIds : buildings.map((b) => b.id)).join(',');
    const cIds = (entity ? (entity.kind === 'compound' ? [entity.id] : []) : entities.filter((e) => e.kind === 'compound').map((e) => e.id)).join(',');
    const filter = cIds ? `compound_id.in.(${cIds}),building_id.in.(${bIds})` : `building_id.in.(${bIds})`;
    const { data } = await supabase.from('amenities').select('*').or(filter).order('kind').order('name');
    const list = (data as Amenity[]) ?? [];
    setRows(list);
    // how much hangs off each one — four light count queries, not four joins
    if (list.length) {
      const ids = list.map((a) => a.id);
      const [c, i, e, s] = await Promise.all([
        supabase.from('service_contracts').select('amenity_id').in('amenity_id', ids),
        supabase.from('inspections').select('amenity_id').in('amenity_id', ids),
        supabase.from('expenses').select('amenity_id').in('amenity_id', ids),
        supabase.from('issues').select('amenity_id').in('amenity_id', ids),
      ]);
      const m: Record<string, { c: number; i: number; e: number; s: number }> = {};
      const bump = (rowsIn: unknown, k: 'c' | 'i' | 'e' | 's') => ((rowsIn as { amenity_id: string }[]) ?? []).forEach((r) => { (m[r.amenity_id] ??= { c: 0, i: 0, e: 0, s: 0 })[k]++; });
      bump(c.data, 'c'); bump(i.data, 'i'); bump(e.data, 'e'); bump(s.data, 's');
      setCounts(m);
    } else setCounts({});
    setLoading(false);
  }

  async function openDetail(a: Amenity) {
    setDetail(a); setLinked(null);
    const [c, i, e, s] = await Promise.all([
      supabase.from('service_contracts').select('id, provider_name, end_date, amount_usd').eq('amenity_id', a.id).order('end_date', { ascending: false }),
      supabase.from('inspections').select('id, title, inspection_date, status, next_due_date').eq('amenity_id', a.id).order('inspection_date', { ascending: false }),
      supabase.from('expenses').select('id, description, expense_date, amount_usd').eq('amenity_id', a.id).order('expense_date', { ascending: false }),
      supabase.from('issues').select('id, title, status, created_at').eq('amenity_id', a.id).order('created_at', { ascending: false }),
    ]);
    setLinked({
      contracts: (c.data as Linked['contracts']) ?? [], inspections: (i.data as Linked['inspections']) ?? [],
      expenses: (e.data as Linked['expenses']) ?? [], issues: (s.data as Linked['issues']) ?? [],
    });
  }

  const vRows = rows.filter((r) => !kindFilter || r.kind === kindFilter);

  function openNew() { setEditId(null); setForm(newForm()); setFile(null); setOpen(true); }
  function openEdit(r: Amenity) {
    setEditId(r.id); setFile(null); setDetail(null);
    setForm({
      kind: r.kind, name: r.name, location: r.location ?? '', install_date: r.install_date ?? '',
      cost: r.cost_usd != null ? String(r.cost_usd) : '', life: r.expected_life_years != null ? String(r.expected_life_years) : '',
      notes: r.notes ?? '', active: r.active, scope: r.building_id && entity?.kind === 'compound' ? 'block' : 'all', block_id: r.building_id ?? '',
    });
    setOpen(true);
  }

  async function save() {
    if (!entity || !form.name.trim()) return;
    setSaving(true);
    const attachment_url = file ? await uploadFile('attachments', `${entity.id}/amenities`, file) : null;
    const compound_id = entity.kind === 'compound' && form.scope === 'all' ? entity.id : null;
    const building_id = entity.kind === 'building' ? entity.id : (form.scope === 'block' ? form.block_id : null);
    if (!compound_id && !building_id) { setSaving(false); toast.error(t('projects.pickBlock')); return; }
    const base: Record<string, unknown> = {
      kind: form.kind, name: form.name.trim(), location: form.location.trim() || null,
      install_date: form.install_date || null, cost_usd: form.cost ? Number(form.cost) : null,
      expected_life_years: form.life ? Number(form.life) : null, notes: form.notes.trim() || null,
      active: form.active, building_id, compound_id, updated_at: new Date().toISOString(),
    };
    if (attachment_url) base.attachment_url = attachment_url;
    const { error } = editId
      ? await supabase.from('amenities').update(base).eq('id', editId)
      : await supabase.from('amenities').insert({ ...base, created_by: profile?.id });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('common.saved'));
    setOpen(false); load();
  }

  async function remove(id: string) {
    if (!confirm(t('amenities.deleteConfirm'))) return;
    const { error } = await supabase.from('amenities').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    setDetail(null); load();
  }

  // replacement planning: install year + expected life
  const replaceYear = (a: Amenity) => a.install_date && a.expected_life_years ? new Date(a.install_date).getFullYear() + a.expected_life_years : null;
  const ageLabel = (a: Amenity) => {
    const y = replaceYear(a); if (!y) return null;
    const left = y - new Date().getFullYear();
    return left <= 0 ? t('amenities.replaceNow', { year: y }) : left <= 2 ? t('amenities.replaceSoon', { year: y }) : t('amenities.replaceAround', { year: y });
  };
  const scopeLabel = (r: Amenity) => r.building_id ? (blockName[r.building_id] ?? t('finance.aBlock')) : (r.compound_id ? t('finance.wholeCompound') : '');
  const empty = useMemo(() => ({ c: 0, i: 0, e: 0, s: 0 }), []);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('amenities.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('amenities.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <RadixSelect value={kindFilter || '__all__'} onValueChange={(v) => setKindFilter(v === '__all__' ? '' : v as AmenityKind)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('amenities.allKinds')}</SelectItem>
              {KINDS.map((k) => <SelectItem key={k} value={k}>{t(`amenities.kinds.${k}`)}</SelectItem>)}
            </SelectContent>
          </RadixSelect>
          {canManage && entity && <Button variant="tinted" onClick={openNew}><Plus size={16} /> {t('amenities.add')}</Button>}
        </div>
      </div>

      {loading ? <SkeletonCards count={3} />
        : vRows.length === 0 ? (
          <Card><CardBody><div className="text-center py-10">
            <Cog className="mx-auto text-primary mb-2" size={28} />
            <p className="text-sm text-muted-foreground">{entity ? t('amenities.none') : t('common.pickEntity')}</p>
          </div></CardBody></Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vRows.map((r) => {
              const n = counts[r.id] ?? empty; const age = ageLabel(r);
              return (
                <Card key={r.id} className={`cursor-pointer hover:bg-primary/5 transition-colors ${!r.active ? 'opacity-60' : ''}`} onClick={() => openDetail(r)}><CardBody>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-1.5"><Badge color="indigo">{t(`amenities.kinds.${r.kind}`)}</Badge>{!r.active && <Badge color="slate">{t('amenities.retired')}</Badge>}</span>
                      <h3 className="font-semibold text-foreground mt-2 truncate">{r.name}</h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{[r.location, scopeLabel(r)].filter(Boolean).join(' · ')}</p>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"><Pencil size={14} /></button>
                        <button onClick={() => remove(r.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><FileSignature size={12} /> {n.c}</span>
                    <span className="inline-flex items-center gap-1"><ClipboardCheck size={12} /> {n.i}</span>
                    <span className="inline-flex items-center gap-1"><Receipt size={12} /> {n.e}</span>
                    <span className="inline-flex items-center gap-1"><AlertTriangle size={12} /> {n.s}</span>
                  </div>
                  {(r.install_date || age) && (
                    <p className={`text-xs mt-2 ${age && (replaceYear(r) ?? 9999) - new Date().getFullYear() <= 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                      {r.install_date ? t('amenities.installed', { date: fmtDate(r.install_date, 'MMM yyyy') }) : ''}{r.install_date && age ? ' · ' : ''}{age ?? ''}
                    </p>
                  )}
                </CardBody></Card>
              );
            })}
          </div>
        )}

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? ''} size="lg">
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge color="indigo">{t(`amenities.kinds.${detail.kind}`)}</Badge>
              {detail.location && <span>{detail.location}</span>}
              {scopeLabel(detail) && <span>· {scopeLabel(detail)}</span>}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { l: t('amenities.installedLabel'), v: detail.install_date ? fmtDate(detail.install_date, 'MMM d, yyyy') : '—' },
                { l: t('amenities.cost'), v: detail.cost_usd != null ? money(Number(detail.cost_usd)) : '—' },
                { l: t('amenities.replace'), v: replaceYear(detail) ? String(replaceYear(detail)) : '—' },
              ].map((x) => (
                <div key={x.l} className="rounded-xl bg-secondary px-3 py-2"><p className="text-[11px] text-muted-foreground uppercase tracking-wide">{x.l}</p><p className="text-sm font-semibold text-foreground mt-0.5 tnum">{x.v}</p></div>
              ))}
            </div>
            {detail.notes && <p className="text-sm text-muted-foreground">{detail.notes}</p>}
            {detail.attachment_url && <AttachmentLink url={detail.attachment_url} label={t('projects.viewDoc')} className="inline-flex items-center gap-1 text-sm text-primary hover:underline" />}
            {!linked ? <p className="text-sm text-muted-foreground">…</p> : (
              <div className="space-y-3">
                {([
                  ['contracts', FileSignature, linked.contracts.map((c) => ({ id: c.id, a: c.provider_name, b: c.end_date ? fmtDate(c.end_date, 'MMM yyyy') : '', v: c.amount_usd != null ? money(Number(c.amount_usd)) : '' }))],
                  ['inspections', ClipboardCheck, linked.inspections.map((i) => ({ id: i.id, a: i.title, b: fmtDate(i.inspection_date, 'MMM d, yyyy'), v: t(`inspections.statuses.${i.status}`, { defaultValue: i.status }) }))],
                  ['expenses', Receipt, linked.expenses.map((e) => ({ id: e.id, a: e.description, b: fmtDate(e.expense_date, 'MMM d, yyyy'), v: money(Number(e.amount_usd)) }))],
                  ['issues', AlertTriangle, linked.issues.map((s) => ({ id: s.id, a: s.title, b: fmtDate(s.created_at, 'MMM d, yyyy'), v: s.status }))],
                ] as const).map(([key, Icon, list]) => (
                  <div key={key}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 inline-flex items-center gap-1.5"><Icon size={12} /> {t(`amenities.linked.${key}`)} · {list.length}</p>
                    {list.length === 0 ? <p className="text-xs text-muted-foreground">{t('amenities.linkedNone')}</p> : (
                      <div className="rounded-xl border border-border divide-y divide-border">
                        {list.slice(0, 8).map((x) => (
                          <div key={x.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                            <span className="text-foreground truncate">{x.a}<span className="text-xs text-muted-foreground ms-2">{x.b}</span></span>
                            <span className="tnum text-muted-foreground flex-shrink-0">{x.v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {linked.expenses.length > 0 && (
                  <p className="text-xs text-muted-foreground">{t('amenities.lifetimeSpend', { amount: money(linked.expenses.reduce((s, e) => s + Number(e.amount_usd), 0)) })}</p>
                )}
              </div>
            )}
            {canManage && <div className="flex justify-end pt-1"><Button variant="secondary" onClick={() => openEdit(detail)}><Pencil size={14} /> {t('common.edit')}</Button></div>}
          </div>
        )}
      </Modal>

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? t('amenities.edit') : t('amenities.add')} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t('amenities.kind')} value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as AmenityKind })}>
              {KINDS.map((k) => <SelectItem key={k} value={k}>{t(`amenities.kinds.${k}`)}</SelectItem>)}
            </SelectField>
            <Input label={t('amenities.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('amenities.namePlaceholder')} />
          </div>
          {entity?.kind === 'compound' && multiBlock && (
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
          <Input label={t('amenities.location')} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder={t('amenities.locationPlaceholder')} />
          <div className="grid grid-cols-3 gap-3">
            <Input label={t('amenities.installedLabel')} type="date" value={form.install_date} onChange={(e) => setForm({ ...form, install_date: e.target.value })} />
            <Input label={t('amenities.cost')} type="number" step="0.01" min="0" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
            <Input label={t('amenities.life')} type="number" step="1" min="1" value={form.life} onChange={(e) => setForm({ ...form, life: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">{t('contracts.notes')}</label>
            <textarea className="rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 min-h-[60px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">{t('projects.attachment')}</label>
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-muted-foreground file:me-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-border file:text-sm file:bg-accent file:text-accent-foreground file:cursor-pointer" />
          </div>
          {editId && (
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="checkbox" checked={!form.active} onChange={(e) => setForm({ ...form, active: !e.target.checked })} className="accent-primary" /> {t('amenities.retireLabel')}
            </label>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save} loading={saving} disabled={!form.name.trim()}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
