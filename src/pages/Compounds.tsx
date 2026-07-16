import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Boxes, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Compound, Organization } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { SkeletonCards } from '@/components/ui/Skeleton';

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

  const [addModal, setAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', city: '' });

  const [editC, setEditC] = useState<Compound | null>(null);
  const [editForm, setEditForm] = useState({ name: '', city: '' });

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

  async function setMode(id: string, mode: string) {
    await supabase.from('compounds').update({ billing_mode: mode }).eq('id', id);
    loadAll();
  }

  async function add() {
    if (!addForm.name.trim()) return;
    const { error } = await supabase.from('compounds').insert({
      name: addForm.name.trim(),
      city: addForm.city.trim() || null,
      org_id: isOrgAdmin ? (myOrgIds[0] ?? null) : null,
    });
    if (error) { toast.error(error.message); return; }
    setAddModal(false);
    setAddForm({ name: '', city: '' });
    loadAll();
  }

  function openEdit(c: Compound) {
    setEditForm({ name: c.name, city: c.city ?? '' });
    setEditC(c);
  }

  async function save() {
    if (!editC || !editForm.name.trim()) return;
    await supabase.from('compounds').update({
      name: editForm.name.trim(),
      city: editForm.city.trim() || null,
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

  const orgName = (orgId: string | null) =>
    orgId ? (organizations.find(o => o.id === orgId)?.name ?? null) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('nav.compounds')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('buildings.compoundHint')}</p>
        </div>
        <Button onClick={() => { setAddForm({ name: '', city: '' }); setAddModal(true); }}>
          <Plus size={16} /> {t('buildings.addCompound')}
        </Button>
      </div>

      {loading ? <SkeletonCards count={3} /> : compounds.length === 0 ? (
        <Card><CardBody><div className="text-center py-10">
          <Boxes className="mx-auto text-primary mb-2" size={28} />
          <p className="text-sm text-muted-foreground">{t('common.noData')}</p>
        </div></CardBody></Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {compounds.map(c => (
            <Card key={c.id}><CardBody>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Boxes size={16} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {blockCounts[c.id] ?? 0} {t('buildings.blocks')} {c.city ? `· ${c.city}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"><Pencil size={14} /></button>
                  <button onClick={() => remove(c.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-2">
                {isPlatformAdmin && orgName(c.org_id ?? null) && (
                  <Badge color="violet">{orgName(c.org_id ?? null)}</Badge>
                )}
                <select
                  value={c.billing_mode}
                  onChange={e => setMode(c.id, e.target.value)}
                  className="rounded-lg border border-border bg-background text-foreground text-xs px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring/50 cursor-pointer"
                >
                  <option value="arrears">{t('buildings.modeArrears')}</option>
                  <option value="dues">{t('buildings.modeDues')}</option>
                </select>
              </div>
            </CardBody></Card>
          ))}
        </div>
      )}

      {/* Add modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title={t('buildings.addCompound')} size="sm">
        <div className="space-y-4">
          <Input label={t('buildings.compoundName')} value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })} placeholder="Marina Gardens" />
          <Input label={t('buildings.cityOptional')} value={addForm.city} onChange={e => setAddForm({ ...addForm, city: e.target.value })} />
          <p className="text-xs text-muted-foreground">{t('buildings.compoundHint')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAddModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={add} disabled={!addForm.name.trim()}>{t('buildings.create')}</Button>
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editC} onClose={() => setEditC(null)} title={`${t('common.edit')} — ${editC?.name ?? ''}`} size="sm">
        <div className="space-y-4">
          <Input label={t('buildings.compoundName')} value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
          <Input label={t('buildings.cityOptional')} value={editForm.city} onChange={e => setEditForm({ ...editForm, city: e.target.value })} />
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
