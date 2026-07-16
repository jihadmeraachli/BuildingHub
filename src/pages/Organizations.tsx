import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Network, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Organization } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { SkeletonCards } from '@/components/ui/Skeleton';

export default function Organizations() {
  const { t } = useTranslation();
  const { isPlatformAdmin } = useAuth();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [buildingCounts, setBuildingCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

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

  if (!isPlatformAdmin) {
    return (
      <Card><CardBody><p className="text-sm text-muted-foreground text-center py-10">
        {t('common.noData')}
      </p></CardBody></Card>
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

      {loading ? <SkeletonCards count={3} /> : orgs.length === 0 ? (
        <Card><CardBody><div className="text-center py-10">
          <Network className="mx-auto text-primary mb-2" size={28} />
          <p className="text-sm text-muted-foreground">{t('common.noData')}</p>
        </div></CardBody></Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {orgs.map(o => (
            <Card key={o.id}><CardBody>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Network size={16} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{o.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {buildingCounts[o.id] ?? 0} {t('nav.buildings').toLowerCase()}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEdit(o)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"><Pencil size={14} /></button>
                  <button onClick={() => remove(o.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"><Trash2 size={14} /></button>
                </div>
              </div>
              {(o.contact_email || o.contact_phone) && (
                <div className="mt-3 pt-3 border-t border-border space-y-0.5 text-xs text-muted-foreground">
                  {o.contact_email && <p>{o.contact_email}</p>}
                  {o.contact_phone && <p>{o.contact_phone}</p>}
                </div>
              )}
            </CardBody></Card>
          ))}
        </div>
      )}

      {/* Add modal */}
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

      {/* Edit modal */}
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
