import { useEffect, useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Network, Pencil, Trash2, Search, X, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Organization } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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

export default function Organizations() {
  const { t } = useTranslation();
  const { isPlatformAdmin } = useAuth();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [buildingCounts, setBuildingCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [addModal, setAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', contact_email: '', contact_phone: '' });

  const [editOrg, setEditOrg] = useState<Organization | null>(null);
  const [editForm, setEditForm] = useState({ name: '', contact_email: '', contact_phone: '' });

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    setLoading(true);
    const [{ data: o }, { data: ob }] = await Promise.all([
      supabase.from('organizations').select('*').order('name'),
      supabase.from('org_buildings').select('org_id, building_id'),
    ]);
    setOrgs((o as Organization[]) ?? []);
    const counts: Record<string, number> = {};
    ((ob ?? []) as { org_id: string }[]).forEach(r => { counts[r.org_id] = (counts[r.org_id] ?? 0) + 1; });
    setBuildingCounts(counts);
    setLoading(false);
  }

  async function add() {
    if (!addForm.name.trim()) return;
    const { error } = await supabase.from('organizations').insert({
      name: addForm.name.trim(),
      contact_email: addForm.contact_email || null,
      contact_phone: addForm.contact_phone || null,
      is_active: true,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(t('buildings.orgAdded'));
    setAddModal(false);
    setAddForm({ name: '', contact_email: '', contact_phone: '' });
    loadAll();
  }

  function openEdit(o: Organization) {
    setEditForm({ name: o.name, contact_email: o.contact_email ?? '', contact_phone: o.contact_phone ?? '' });
    setEditOrg(o);
  }

  async function save() {
    if (!editOrg || !editForm.name.trim()) return;
    const { error } = await supabase.from('organizations').update({
      name: editForm.name.trim(),
      contact_email: editForm.contact_email || null,
      contact_phone: editForm.contact_phone || null,
    }).eq('id', editOrg.id);
    if (error) { toast.error(error.message); return; }
    setEditOrg(null);
    loadAll();
  }

  async function remove(id: string) {
    if (!confirm('Delete this organization? Building assignments are removed but buildings are kept.')) return;
    await supabase.from('organizations').delete().eq('id', id);
    setEditOrg(null);
    loadAll();
  }

  const statusOptions: FilterOption[] = [
    { value: '', label: 'All' },
    { value: 'active', label: t('buildings.active') },
    { value: 'inactive', label: t('buildings.inactive') },
  ];

  const filtered = useMemo(() => {
    let result = orgs;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(o =>
        o.name.toLowerCase().includes(q) ||
        (o.contact_email ?? '').toLowerCase().includes(q)
      );
    }
    if (statusFilter === 'active') result = result.filter(o => o.is_active);
    else if (statusFilter === 'inactive') result = result.filter(o => !o.is_active);
    return result;
  }, [orgs, search, statusFilter]);

  const activeFilterCount = statusFilter ? 1 : 0;

  if (!isPlatformAdmin) {
    return (
      <Card><div className="p-6"><p className="text-sm text-muted-foreground text-center py-10">{t('common.noData')}</p></div></Card>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('nav.organizations')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('buildings.orgHint')}</p>
        </div>
        <Button onClick={() => { setAddForm({ name: '', contact_email: '', contact_phone: '' }); setAddModal(true); }}>
          <Plus size={16} /> {t('buildings.addOrganization')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search organizations..."
            className="w-full text-sm rounded-lg border border-border bg-background pl-9 pr-8 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer">
              <X size={13} />
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground whitespace-nowrap">
          {filtered.length} of {orgs.length}
        </p>
        {activeFilterCount > 0 && (
          <button
            onClick={() => setStatusFilter('')}
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
                  <th className="text-start text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">
                    Contact
                  </th>
                  <th className="text-start text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">
                    {t('nav.buildings')}
                  </th>
                  <th className="text-start text-xs font-medium text-muted-foreground px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span>{t('common.status')}</span>
                      <SearchableColFilter value={statusFilter} onChange={setStatusFilter} options={statusOptions} />
                    </div>
                  </th>
                  <th className="py-3 px-4 w-20" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center">
                      <Network size={20} className="mx-auto text-muted-foreground/40 mb-2" />
                      <p className="text-xs text-muted-foreground">{t('common.noData')}</p>
                    </td>
                  </tr>
                ) : filtered.map(o => (
                  <tr key={o.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Network size={13} className="text-primary" />
                        </div>
                        <span className="font-medium text-foreground">{o.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        {o.contact_email && <p>{o.contact_email}</p>}
                        {o.contact_phone && <p>{o.contact_phone}</p>}
                        {!o.contact_email && !o.contact_phone && <span className="text-muted-foreground/40">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-sm text-muted-foreground">
                      {buildingCounts[o.id] ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={o.is_active ? 'green' : 'slate'}>
                        {o.is_active ? t('buildings.active') : t('buildings.inactive')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(o)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => remove(o.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer">
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

      <Modal open={addModal} onClose={() => setAddModal(false)} title={t('buildings.addOrganization')} size="sm">
        <div className="space-y-4">
          <Input label={t('buildings.orgName')} value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })} placeholder="Al Futtaim Property Management" />
          <Input label={t('buildings.orgEmail')} type="email" value={addForm.contact_email} onChange={e => setAddForm({ ...addForm, contact_email: e.target.value })} />
          <Input label={t('buildings.orgPhone')} type="tel" value={addForm.contact_phone} onChange={e => setAddForm({ ...addForm, contact_phone: e.target.value })} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAddModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={add} disabled={!addForm.name.trim()}>{t('buildings.create')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!editOrg} onClose={() => setEditOrg(null)} title={`${t('common.edit')} — ${editOrg?.name ?? ''}`} size="sm">
        <div className="space-y-4">
          <Input label={t('buildings.orgName')} value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
          <Input label={t('buildings.orgEmail')} type="email" value={editForm.contact_email} onChange={e => setEditForm({ ...editForm, contact_email: e.target.value })} />
          <Input label={t('buildings.orgPhone')} type="tel" value={editForm.contact_phone} onChange={e => setEditForm({ ...editForm, contact_phone: e.target.value })} />
          <div className="flex justify-between gap-2 pt-1">
            <Button variant="danger" onClick={() => editOrg && remove(editOrg.id)}><Trash2 size={15} /> {t('common.delete')}</Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditOrg(null)}>{t('common.cancel')}</Button>
              <Button onClick={save}>{t('common.save')}</Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
