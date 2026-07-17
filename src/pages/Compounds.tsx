import { useEffect, useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Boxes, Pencil, Trash2, Search, X, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Compound, Organization } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, SelectInput } from '@/components/ui/Input';
import { LEBANON_CITIES, COUNTRIES } from '@/lib/locationData';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';

type FilterOption = { value: string; label: string };

function SearchableColFilter({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: FilterOption[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function toggle() {
    if (!open && triggerRef.current) {
      setRect(triggerRef.current.getBoundingClientRect());
      setQuery('');
    }
    setOpen(v => !v);
  }

  const visible = options.filter(o =>
    o.value === '' || !query || o.label.toLowerCase().includes(query.toLowerCase())
  );

  const selectedLabel = options.find(o => o.value === value)?.label ?? 'All';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        title={value ? selectedLabel : undefined}
        className={cn(
          'inline-flex items-center justify-center w-4 h-4 rounded transition-colors cursor-pointer focus:outline-none',
          value ? 'text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'
        )}
      >
        <ChevronDown size={12} />
      </button>

      {open && rect && createPortal(
        <div
          ref={dropRef}
          style={{
            position: 'fixed',
            top: rect.bottom + 4,
            left: rect.left,
            minWidth: Math.max(rect.width, 200),
            zIndex: 9999,
          }}
          className="bg-popover border border-border rounded-lg shadow-xl overflow-hidden"
        >
          <div className="p-1.5 border-b border-border">
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search..."
                className="w-full text-xs rounded pl-6 pr-2 py-1 bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring/50"
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto py-0.5">
            {visible.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No matches</p>
            ) : visible.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); setQuery(''); }}
                className={cn(
                  'w-full text-left text-xs px-3 py-1.5 hover:bg-accent transition-colors cursor-pointer',
                  o.value === value ? 'text-primary font-medium bg-primary/5' : 'text-foreground'
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default function Compounds() {
  const { t } = useTranslation();
  const { isPlatformAdmin, grants } = useAuth();

  const myOrgIds = grants
    .filter(g => g.scope_type === 'org' && g.role === 'org_admin')
    .map(g => g.org_id as string)
    .filter(Boolean);
  const isOrgAdmin = !isPlatformAdmin && myOrgIds.length > 0;

  const [compounds, setCompounds] = useState<Compound[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [blockCounts, setBlockCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [billingFilter, setBillingFilter] = useState('');

  const [addModal, setAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', city: '', country: 'Lebanon' });

  const [editC, setEditC] = useState<Compound | null>(null);
  const [editForm, setEditForm] = useState({ name: '', city: '', country: 'Lebanon', billing_mode: 'arrears' });

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    setLoading(true);
    const [{ data: c }, { data: b }] = await Promise.all([
      supabase.from('compounds').select('*').order('name'),
      supabase.from('buildings').select('id, compound_id'),
    ]);
    let allCompounds = (c as Compound[]) ?? [];
    if (isOrgAdmin) allCompounds = allCompounds.filter(comp => myOrgIds.includes(comp.org_id ?? ''));
    setCompounds(allCompounds);
    const counts: Record<string, number> = {};
    ((b ?? []) as { compound_id: string | null }[]).forEach(row => {
      if (row.compound_id) counts[row.compound_id] = (counts[row.compound_id] ?? 0) + 1;
    });
    setBlockCounts(counts);

    if (isPlatformAdmin) {
      const { data: o } = await supabase.from('organizations').select('*').order('name');
      setOrganizations((o as Organization[]) ?? []);
    }
    setLoading(false);
  }

  async function add() {
    if (!addForm.name.trim()) return;
    const { error } = await supabase.from('compounds').insert({
      name: addForm.name.trim(),
      city: addForm.city || null,
      country: addForm.country,
      org_id: isOrgAdmin ? (myOrgIds[0] ?? null) : null,
    });
    if (error) { toast.error(error.message); return; }
    setAddModal(false);
    setAddForm({ name: '', city: '', country: 'Lebanon' });
    loadAll();
  }

  function openEdit(c: Compound) {
    setEditForm({ name: c.name, city: c.city ?? '', country: c.country ?? 'Lebanon', billing_mode: c.billing_mode });
    setEditC(c);
  }

  async function save() {
    if (!editC || !editForm.name.trim()) return;
    await supabase.from('compounds').update({
      name: editForm.name.trim(),
      city: editForm.city || null,
      country: editForm.country,
      billing_mode: editForm.billing_mode,
    }).eq('id', editC.id);
    setEditC(null);
    loadAll();
  }

  async function remove(id: string) {
    if (!confirm('Delete this compound? Its buildings are detached (kept), but compound-level records are removed.')) return;
    await supabase.from('compounds').delete().eq('id', id);
    setEditC(null);
    loadAll();
  }

  const cityOptions: FilterOption[] = useMemo(() => {
    const cities = [...new Set(compounds.map(c => c.city).filter(Boolean) as string[])].sort();
    return [{ value: '', label: 'All cities' }, ...cities.map(c => ({ value: c, label: c }))];
  }, [compounds]);

  const orgOptions: FilterOption[] = useMemo(() => {
    const hasNone = compounds.some(c => !c.org_id);
    return [
      { value: '', label: 'All organizations' },
      ...(hasNone ? [{ value: '__none__', label: '— None —' }] : []),
      ...organizations.map(o => ({ value: o.id, label: o.name })),
    ];
  }, [compounds, organizations]);

  const billingOptions: FilterOption[] = [
    { value: '', label: 'All' },
    { value: 'arrears', label: t('buildings.modeArrears') },
    { value: 'dues', label: t('buildings.modeDues') },
  ];

  const filtered = useMemo(() => {
    let result = compounds;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(c => c.name.toLowerCase().includes(q) || (c.city ?? '').toLowerCase().includes(q));
    }
    if (cityFilter) result = result.filter(c => c.city === cityFilter);
    if (orgFilter === '__none__') result = result.filter(c => !c.org_id);
    else if (orgFilter) result = result.filter(c => c.org_id === orgFilter);
    if (billingFilter) result = result.filter(c => c.billing_mode === billingFilter);
    return result;
  }, [compounds, search, cityFilter, orgFilter, billingFilter]);

  const activeFilterCount = [cityFilter, orgFilter, billingFilter].filter(Boolean).length;

  const orgName = (orgId: string | null) =>
    orgId ? (organizations.find(o => o.id === orgId)?.name ?? null) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('nav.compounds')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('buildings.compoundHint')}</p>
        </div>
        <Button onClick={() => { setAddForm({ name: '', city: '', country: 'Lebanon' }); setAddModal(true); }}>
          <Plus size={16} /> {t('buildings.addCompound')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search compounds..."
            className="w-full text-sm rounded-lg border border-border bg-background pl-9 pr-8 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer">
              <X size={13} />
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground whitespace-nowrap">
          {filtered.length} of {compounds.length}
        </p>
        {activeFilterCount > 0 && (
          <button
            onClick={() => { setCityFilter(''); setOrgFilter(''); setBillingFilter(''); }}
            className="text-xs text-primary hover:underline cursor-pointer whitespace-nowrap"
          >
            Clear filters ({activeFilterCount})
          </button>
        )}
      </div>

      {loading ? <SkeletonCards count={3} /> : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-start text-xs font-medium text-muted-foreground px-4 py-3">
                    {t('buildings.name')}
                  </th>
                  <th className="text-start text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">
                    <div className="flex items-center gap-1.5">
                      <span>{t('buildings.city')}</span>
                      <SearchableColFilter value={cityFilter} onChange={setCityFilter} options={cityOptions} />
                    </div>
                  </th>
                  {isPlatformAdmin && (
                    <th className="text-start text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">
                      <div className="flex items-center gap-1.5">
                        <span>{t('nav.organizations')}</span>
                        <SearchableColFilter value={orgFilter} onChange={setOrgFilter} options={orgOptions} />
                      </div>
                    </th>
                  )}
                  <th className="text-start text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">
                    {t('buildings.blocks')}
                  </th>
                  <th className="text-start text-xs font-medium text-muted-foreground px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span>Billing</span>
                      <SearchableColFilter value={billingFilter} onChange={setBillingFilter} options={billingOptions} />
                    </div>
                  </th>
                  <th className="py-3 px-4 w-20" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={isPlatformAdmin ? 6 : 5} className="py-12 text-center">
                      <Boxes size={20} className="mx-auto text-muted-foreground/40 mb-2" />
                      <p className="text-xs text-muted-foreground">{t('common.noData')}</p>
                    </td>
                  </tr>
                ) : filtered.map(c => (
                  <tr key={c.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Boxes size={13} className="text-primary" />
                        </div>
                        <span className="font-medium text-foreground">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-sm text-muted-foreground">
                      {c.city ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                    {isPlatformAdmin && (
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {orgName(c.org_id) ? (
                          <Badge color="violet">{orgName(c.org_id)}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 hidden sm:table-cell text-sm text-muted-foreground">
                      {blockCounts[c.id] ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={c.billing_mode === 'dues' ? 'blue' : 'slate'}>
                        {c.billing_mode === 'dues' ? t('buildings.modeDues') : t('buildings.modeArrears')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => remove(c.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={addModal} onClose={() => setAddModal(false)} title={t('buildings.addCompound')} size="sm">
        <div className="space-y-4">
          <Input label={t('buildings.compoundName')} value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })} placeholder="Marina Gardens" />
          <div className="grid grid-cols-2 gap-3">
            <SelectInput label={t('buildings.city')} value={addForm.city} onChange={e => setAddForm({ ...addForm, city: e.target.value })}>
              <option value="">— {t('buildings.city')} —</option>
              {LEBANON_CITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </SelectInput>
            <SelectInput label={t('buildings.country')} value={addForm.country} onChange={e => setAddForm({ ...addForm, country: e.target.value })}>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </SelectInput>
          </div>
          <p className="text-xs text-muted-foreground">{t('buildings.compoundHint')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAddModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={add} disabled={!addForm.name.trim()}>{t('buildings.create')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!editC} onClose={() => setEditC(null)} title={`${t('common.edit')} — ${editC?.name ?? ''}`} size="sm">
        <div className="space-y-4">
          <Input label={t('buildings.compoundName')} value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <SelectInput label={t('buildings.city')} value={editForm.city} onChange={e => setEditForm({ ...editForm, city: e.target.value })}>
              <option value="">— {t('buildings.city')} —</option>
              {LEBANON_CITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </SelectInput>
            <SelectInput label={t('buildings.country')} value={editForm.country} onChange={e => setEditForm({ ...editForm, country: e.target.value })}>
              {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
            </SelectInput>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Billing mode</label>
            <select
              value={editForm.billing_mode}
              onChange={e => setEditForm({ ...editForm, billing_mode: e.target.value })}
              className="w-full rounded-lg border border-border bg-background text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring/50 cursor-pointer"
            >
              <option value="arrears">{t('buildings.modeArrears')}</option>
              <option value="dues">{t('buildings.modeDues')}</option>
            </select>
          </div>
          <div className="flex justify-between gap-2 pt-1">
            <Button variant="danger" onClick={() => editC && remove(editC.id)}><Trash2 size={15} /> {t('common.delete')}</Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditC(null)}>{t('common.cancel')}</Button>
              <Button onClick={save}>{t('common.save')}</Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
