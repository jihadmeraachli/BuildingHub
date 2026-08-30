import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtDate } from '@/lib/dateFmt';
import { Plus, HardHat, Pencil, Trash2, Receipt } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { uploadFile } from '@/lib/upload';
import { AttachmentLink } from '@/components/ui/AttachmentLink';
import { useAuth } from '@/contexts/AuthContext';
import { useViewableBuildings } from '@/lib/useViewableBuildings';
import { useEntities } from '@/lib/entities';
import type { Project, ProjectStatus, Expense, BuildingContact } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RadixSelect, SelectField, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { fmtMoney } from '@/lib/money';

/**
 * Projects (0109) — the facade, the generator, the lift. The page a committee
 * opens when someone asks "we said $18,000, where are we?"
 *
 * Actual cost is never typed in: it is the sum of the expenses tagged to the
 * project in Finance, so the number here is the book's number. Residents see
 * this page read-only; that is the point of it.
 */
const STATUSES: ProjectStatus[] = ['planned', 'approved', 'in_progress', 'done', 'cancelled'];
const money = (n: number) => fmtMoney(n);

type Form = {
  title: string; description: string; status: ProjectStatus; estimate: string;
  start_date: string; end_date: string; scope: 'all' | 'block'; block_id: string;
  contact_id: string; // 0123: the contractor/company, picked from Contacts — '' = none
};
const newForm = (): Form => ({
  title: '', description: '', status: 'planned', estimate: '', start_date: '', end_date: '', scope: 'all', block_id: '', contact_id: '',
});

export default function Projects() {
  const { t } = useTranslation();
  const { can, isPlatformAdmin, profile } = useAuth();
  const { buildings } = useViewableBuildings();
  const entities = useEntities(buildings);
  const { entityKey } = useAuth();
  const entity = entities.find((e) => e.key === entityKey) ?? null;

  const [statusFilter, setStatusFilter] = useState<'' | ProjectStatus>('');
  const [rows, setRows] = useState<Project[]>([]);
  const [contacts, setContacts] = useState<BuildingContact[]>([]);
  const [expenses, setExpenses] = useState<Pick<Expense, 'id' | 'project_id' | 'amount_usd' | 'expense_date' | 'description' | 'funded_by_fund_usd'>[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(newForm());
  const [file, setFile] = useState<File | null>(null);
  const [detail, setDetail] = useState<Project | null>(null);

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
    const [{ data: p }, { data: x }, { data: c }] = await Promise.all([
      supabase.from('projects').select('*').or(filter).order('created_at', { ascending: false }),
      // the actuals: every expense in scope that points at a project
      supabase.from('expenses').select('id, project_id, amount_usd, expense_date, description, funded_by_fund_usd').or(filter).not('project_id', 'is', null),
      // 0123: contacts in the same scope — the contractor/company picker
      supabase.from('building_contacts').select('*').or(filter).order('title'),
    ]);
    setRows((p as Project[]) ?? []);
    setExpenses((x as typeof expenses) ?? []);
    setContacts((c as BuildingContact[]) ?? []);
    setLoading(false);
  }

  const actualOf = useMemo(() => {
    const m = new Map<string, number>();
    expenses.forEach((e) => { if (e.project_id) m.set(e.project_id, (m.get(e.project_id) ?? 0) + Number(e.amount_usd)); });
    return m;
  }, [expenses]);
  const contactName = useMemo(
    () => Object.fromEntries(contacts.map((c) => [c.id, c.name || c.title])),
    [contacts],
  );

  const vRows = rows.filter((r) => !statusFilter || r.status === statusFilter);

  function openNew() { setEditId(null); setForm(newForm()); setFile(null); setOpen(true); }
  function openEdit(r: Project) {
    setEditId(r.id); setFile(null); setDetail(null);
    setForm({
      title: r.title, description: r.description ?? '', status: r.status, estimate: r.estimate_usd != null ? String(r.estimate_usd) : '',
      start_date: r.start_date ?? '', end_date: r.end_date ?? '', scope: r.building_id && entity?.kind === 'compound' ? 'block' : 'all', block_id: r.building_id ?? '',
      contact_id: r.contact_id ?? '',
    });
    setOpen(true);
  }

  async function save() {
    if (!entity || !form.title.trim()) return;
    setSaving(true);
    const attachment_url = file ? await uploadFile('attachments', `${entity.id}/projects`, file) : null;
    const compound_id = entity.kind === 'compound' && form.scope === 'all' ? entity.id : null;
    const building_id = entity.kind === 'building' ? entity.id : (form.scope === 'block' ? form.block_id : null);
    if (!compound_id && !building_id) { setSaving(false); toast.error(t('projects.pickBlock')); return; }
    const base: Record<string, unknown> = {
      title: form.title.trim(), description: form.description.trim() || null, status: form.status,
      estimate_usd: form.estimate ? Number(form.estimate) : null,
      start_date: form.start_date || null, end_date: form.end_date || null,
      building_id, compound_id, updated_at: new Date().toISOString(),
      contact_id: form.contact_id || null,
    };
    if (attachment_url) base.attachment_url = attachment_url;
    const { error } = editId
      ? await supabase.from('projects').update(base).eq('id', editId)
      : await supabase.from('projects').insert({ ...base, created_by: profile?.id });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('common.saved'));
    setOpen(false); load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from('projects').delete().eq('id', id);
    setConfirmDelete(null);
    if (error) { toast.error(error.message); return; }
    setDetail(null); load();
  }

  const statusColor: Record<ProjectStatus, 'slate' | 'blue' | 'yellow' | 'green' | 'red'> = {
    planned: 'slate', approved: 'blue', in_progress: 'yellow', done: 'green', cancelled: 'red',
  };
  const scopeLabel = (r: Project) => r.building_id ? (blockName[r.building_id] ?? t('finance.aBlock')) : (r.compound_id ? t('finance.wholeCompound') : '');

  // estimate vs actual, read as a committee reads it
  function progress(r: Project) {
    const actual = actualOf.get(r.id) ?? 0;
    const est = r.estimate_usd != null ? Number(r.estimate_usd) : null;
    const pct = est && est > 0 ? Math.min(100, Math.round((actual / est) * 100)) : null;
    const over = est != null && actual > est + 0.005;
    return { actual, est, pct, over };
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('projects.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('projects.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <RadixSelect value={statusFilter || '__all__'} onValueChange={(v) => setStatusFilter(v === '__all__' ? '' : v as ProjectStatus)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('projects.allStatuses')}</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`projects.status.${s}`)}</SelectItem>)}
            </SelectContent>
          </RadixSelect>
          {canManage && entity && <Button variant="tinted" onClick={openNew}><Plus size={16} /> {t('projects.add')}</Button>}
        </div>
      </div>

      {loading ? <SkeletonCards count={3} />
        : vRows.length === 0 ? (
          <Card><CardBody><div className="text-center py-10">
            <HardHat className="mx-auto text-primary mb-2" size={28} />
            <p className="text-sm text-muted-foreground">{entity ? t('projects.none') : t('common.pickEntity')}</p>
          </div></CardBody></Card>
        ) : (
          <div className="space-y-3">
            {vRows.map((r) => {
              const p = progress(r);
              return (
                <Card key={r.id} className="cursor-pointer hover:bg-primary/5 transition-colors" onClick={() => setDetail(r)}><CardBody>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h3 className="font-semibold text-foreground">{r.title}</h3>
                        <Badge color={statusColor[r.status]}>{t(`projects.status.${r.status}`)}</Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {scopeLabel(r) && <span>{scopeLabel(r)}</span>}
                        {r.contact_id && contactName[r.contact_id] && <><span>•</span><span>{contactName[r.contact_id]}</span></>}
                        {(r.start_date || r.end_date) && (
                          <><span>•</span><span>{r.start_date ? fmtDate(r.start_date, 'MMM yyyy') : '—'} → {r.end_date ? fmtDate(r.end_date, 'MMM yyyy') : '—'}</span></>
                        )}
                      </div>
                      {p.over && <p className="text-xs text-red-500 mt-1">{t('projects.overBy', { amount: money(p.actual - (p.est ?? 0)) })}</p>}
                    </div>
                    <div className="w-44 flex-shrink-0">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="text-muted-foreground text-xs">{t('projects.spent')}</span>
                        <span className={`tnum font-semibold ${p.over ? 'text-red-500' : 'text-foreground'}`}>{money(p.actual)}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2 text-sm mt-0.5">
                        <span className="text-muted-foreground text-xs">{t('projects.estimate')}</span>
                        <span className="tnum text-foreground">{p.est != null ? money(p.est) : '—'}</span>
                      </div>
                      {p.pct != null && (
                        <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div className={`h-full rounded-full ${p.over ? 'bg-red-500' : 'bg-primary'}`} style={{ width: `${p.pct}%` }} />
                        </div>
                      )}
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"><Pencil size={15} /></button>
                        <button onClick={() => setConfirmDelete(r.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"><Trash2 size={15} /></button>
                      </div>
                    )}
                  </div>
                </CardBody></Card>
              );
            })}
          </div>
        )}

      {/* detail: the expenses behind the number */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.title ?? ''} size="lg">
        {detail && (() => {
          const p = progress(detail);
          const list = expenses.filter((e) => e.project_id === detail.id).sort((a, b) => (a.expense_date < b.expense_date ? 1 : -1));
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={statusColor[detail.status]}>{t(`projects.status.${detail.status}`)}</Badge>
                {scopeLabel(detail) && <span className="text-xs text-muted-foreground">{scopeLabel(detail)}</span>}
                {detail.contact_id && contactName[detail.contact_id] && (
                  <span className="text-xs text-muted-foreground">· {contactName[detail.contact_id]}</span>
                )}
              </div>
              {detail.description && <p className="text-sm text-muted-foreground">{detail.description}</p>}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { l: t('projects.estimate'), v: p.est != null ? money(p.est) : '—' },
                  { l: t('projects.spent'), v: money(p.actual), red: p.over },
                  { l: t('projects.remaining'), v: p.est != null ? money(p.est - p.actual) : '—', red: p.over },
                ].map((x) => (
                  <div key={x.l} className="rounded-xl bg-secondary px-3 py-2">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{x.l}</p>
                    <p className={`text-sm font-semibold mt-0.5 tnum ${x.red ? 'text-red-500' : 'text-foreground'}`}>{x.v}</p>
                  </div>
                ))}
              </div>
              {detail.attachment_url && (
                <AttachmentLink url={detail.attachment_url} label={t('projects.viewDoc')} className="inline-flex items-center gap-1 text-sm text-primary hover:underline" />
              )}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t('projects.expenses')}</p>
                {list.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('projects.noExpenses')}</p>
                ) : (
                  <div className="rounded-xl border border-border divide-y divide-border">
                    {list.map((e) => (
                      <div key={e.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="inline-flex items-center gap-2 text-foreground"><Receipt size={13} className="text-muted-foreground" />{fmtDate(e.expense_date, 'dd-MM-yyyy')} · {e.description}</span>
                        <span className="tnum font-medium">{money(Number(e.amount_usd))}{Number(e.funded_by_fund_usd ?? 0) > 0 && <span className="ms-1.5 text-[10px] text-amber-600">{t('fund.paidFromFund')}</span>}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {canManage && (
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="secondary" onClick={() => openEdit(detail)}><Pencil size={14} /> {t('common.edit')}</Button>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? t('projects.edit') : t('projects.add')} size="lg">
        <div className="space-y-4">
          <Input label={t('projects.name')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t('projects.namePlaceholder')} />
          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t('projects.statusLabel')} value={form.status} onValueChange={(v) => setForm({ ...form, status: v as ProjectStatus })}>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`projects.status.${s}`)}</SelectItem>)}
            </SelectField>
            <Input label={t('projects.estimateUsd')} type="number" step="0.01" min="0" value={form.estimate} onChange={(e) => setForm({ ...form, estimate: e.target.value })} />
          </div>
          {editId && (
            <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5">
              <span className="text-sm text-muted-foreground">{t('projects.spentFromFinance')}</span>
              <span className="text-sm font-semibold tnum text-foreground">{money(actualOf.get(editId) ?? 0)}</span>
            </div>
          )}
          {/* 0123: the contractor/company is picked from Contacts — add it there first. */}
          {contacts.length > 0 ? (
            <SelectField label={t('projects.contractor')} value={form.contact_id || '__none__'} onValueChange={(v) => setForm({ ...form, contact_id: v === '__none__' ? '' : v })}>
              <SelectItem value="__none__">{t('amenities.linkNone')}</SelectItem>
              {contacts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name || c.title}</SelectItem>)}
            </SelectField>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-muted-foreground">{t('projects.contractor')}</label>
              <p className="text-xs text-muted-foreground">
                {t('contracts.noContactsYet')}{' '}
                <Link to="/contacts" className="text-primary hover:underline">{t('contracts.addContactLink')}</Link>
              </p>
            </div>
          )}
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
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('contracts.startDate')} type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            <Input label={t('contracts.endDate')} type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">{t('finance.description')}</label>
            <textarea className="rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 min-h-[70px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t('projects.descriptionPlaceholder')} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-muted-foreground">{t('projects.attachment')}</label>
            <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-muted-foreground file:me-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-border file:text-sm file:bg-accent file:text-accent-foreground file:cursor-pointer" />
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-2.5">
            <p className="text-xs text-foreground/80 leading-relaxed">{t('projects.howActualWorks')}</p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={save} loading={saving} disabled={!form.title.trim()}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!confirmDelete} onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        title={t('projects.deleteTitle')} message={t('projects.deleteConfirm')}
        confirmLabel={t('common.delete')}
      />
    </div>
  );
}
