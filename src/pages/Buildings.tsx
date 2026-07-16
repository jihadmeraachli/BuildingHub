import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { Plus, Building2, MapPin, ExternalLink, Boxes, Pencil, Trash2, Network } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Building, Compound, Organization } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Controller } from 'react-hook-form';
import { SelectField, SelectItem } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { SkeletonCards } from '@/components/ui/Skeleton';

type FormData = {
  name: string; address: string; city: string; country: string;
  contact_email: string; contact_phone: string; maps_url: string; compound_id: string;
};

type OrgBuilding = { org_id: string; building_id: string };

function buildEmbedUrl(b: Building): string {
  const query = encodeURIComponent(`${b.address}, ${b.city}, ${b.country}`);
  return `https://maps.google.com/maps?q=${query}&output=embed`;
}

export default function Buildings() {
  const { t } = useTranslation();
  const { isPlatformAdmin, grants } = useAuth();

  // Derive org_admin context from grants
  const myOrgIds = grants
    .filter(g => g.scope_type === 'org' && g.role === 'org_admin')
    .map(g => g.org_id as string)
    .filter(Boolean);
  const isOrgAdmin = !isPlatformAdmin && myOrgIds.length > 0;

  const [buildings, setBuildings] = useState<Building[]>([]);
  const [compounds, setCompounds] = useState<Compound[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [orgBuildings, setOrgBuildings] = useState<OrgBuilding[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [mapBuilding, setMapBuilding] = useState<Building | null>(null);
  const [editB, setEditB] = useState<Building | null>(null);
  const [ebForm, setEbForm] = useState({ name: '', address: '', city: '', country: '', contact_email: '', contact_phone: '', maps_url: '' });

  const { register, handleSubmit, reset, control, formState: { isSubmitting } } = useForm<FormData>();

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAll() {
    setLoading(true);
    const [{ data: b }, { data: c }] = await Promise.all([
      supabase.from('buildings').select('*').order('name'),
      supabase.from('compounds').select('*').order('name'),
    ]);
    setBuildings((b as Building[]) ?? []);
    setCompounds((c as Compound[]) ?? []);

    if (isPlatformAdmin) {
      const [{ data: o }, { data: ob }] = await Promise.all([
        supabase.from('organizations').select('*').order('name'),
        supabase.from('org_buildings').select('org_id, building_id'),
      ]);
      setOrganizations((o as Organization[]) ?? []);
      setOrgBuildings((ob as OrgBuilding[]) ?? []);
    } else if (myOrgIds.length) {
      const { data: ob } = await supabase
        .from('org_buildings')
        .select('org_id, building_id')
        .in('org_id', myOrgIds);
      setOrgBuildings((ob as OrgBuilding[]) ?? []);
    }

    setLoading(false);
  }

  const orgByBuilding = Object.fromEntries(orgBuildings.map((ob) => [ob.building_id, ob.org_id]));

  // org_admins only see buildings in their org(s)
  const visibleBuildings = isOrgAdmin
    ? buildings.filter(b => orgBuildings.some(ob => ob.building_id === b.id))
    : buildings;

  // org_admins only see compounds they created (org_id matches); platform admin sees all
  const visibleCompounds = isOrgAdmin
    ? compounds.filter(c => myOrgIds.includes(c.org_id ?? ''))
    : compounds;

  async function onSubmit(data: FormData) {
    const { data: inserted, error } = await supabase.from('buildings').insert({
      name: data.name, address: data.address, city: data.city, country: data.country,
      contact_email: data.contact_email || null, contact_phone: data.contact_phone || null,
      maps_url: data.maps_url || null, compound_id: data.compound_id || null, is_active: true,
    }).select('id').single();

    if (error) { toast.error(error.message); return; }

    // org_admins: auto-link new building to their org
    if (isOrgAdmin && myOrgIds[0] && inserted) {
      await supabase.from('org_buildings').insert({ org_id: myOrgIds[0], building_id: (inserted as { id: string }).id });
    }

    toast.success(t('buildings.buildingAdded'));
    setModalOpen(false);
    reset();
    loadAll();
  }

  async function assignCompound(buildingId: string, compoundId: string) {
    await supabase.from('buildings').update({ compound_id: compoundId || null }).eq('id', buildingId);
    loadAll();
  }

  async function setBuildingMode(id: string, mode: string) {
    await supabase.from('buildings').update({ billing_mode: mode }).eq('id', id);
    loadAll();
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase.from('buildings').update({ is_active: !current }).eq('id', id);
    loadAll();
  }

  function openEditB(b: Building) {
    setEbForm({ name: b.name, address: b.address, city: b.city, country: b.country, contact_email: b.contact_email ?? '', contact_phone: b.contact_phone ?? '', maps_url: b.maps_url ?? '' });
    setEditB(b);
  }
  async function saveEditB() {
    if (!editB || !ebForm.name.trim()) return;
    await supabase.from('buildings').update({
      name: ebForm.name.trim(), address: ebForm.address, city: ebForm.city, country: ebForm.country,
      contact_email: ebForm.contact_email || null, contact_phone: ebForm.contact_phone || null, maps_url: ebForm.maps_url || null,
    }).eq('id', editB.id);
    setEditB(null); loadAll();
  }
  async function deleteB(id: string) {
    if (!confirm('Delete this building and ALL its units, charges, payments, etc.? This cannot be undone.')) return;
    await supabase.from('buildings').delete().eq('id', id);
    setEditB(null); loadAll();
  }

  async function assignOrg(buildingId: string, orgId: string) {
    await supabase.from('org_buildings').delete().eq('building_id', buildingId);
    if (orgId) {
      const { error } = await supabase.from('org_buildings').insert({ org_id: orgId, building_id: buildingId });
      if (error) { toast.error(error.message); return; }
    }
    loadAll();
  }

  const compoundName = (id: string | null) => id ? compounds.find((c) => c.id === id)?.name ?? null : null;
  const orgName = (buildingId: string) => {
    const orgId = orgByBuilding[buildingId];
    return orgId ? organizations.find((o) => o.id === orgId)?.name ?? null : null;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('buildings.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('buildings.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setModalOpen(true)}><Plus size={16} /> {t('buildings.addBuilding')}</Button>
        </div>
      </div>

      {loading ? (
        <SkeletonCards count={3} />
      ) : visibleBuildings.length === 0 ? (
        <Card><CardBody><p className="text-sm text-muted-foreground text-center py-10">{t('buildings.noBuildings')}</p></CardBody></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleBuildings.map((b) => (
            <Card key={b.id} className="transition-shadow hover:shadow-md">
              <CardBody>
                <div className="flex items-start justify-between gap-3">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Building2 size={20} className="text-primary" />
                  </div>
                  <Badge color={b.is_active ? 'green' : 'slate'}>{b.is_active ? t('buildings.active') : t('buildings.inactive')}</Badge>
                </div>

                <h3 className="font-semibold text-foreground mt-3">{b.name}</h3>
                <p className="text-sm text-muted-foreground">{b.address}</p>
                <p className="text-sm text-muted-foreground">{b.city}, {b.country}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {compoundName(b.compound_id) && (
                    <div className="inline-flex items-center gap-1 text-xs text-primary bg-primary/10 rounded-full px-2 py-0.5">
                      <Boxes size={11} /> {compoundName(b.compound_id)}
                    </div>
                  )}
                  {isPlatformAdmin && orgName(b.id) && (
                    <div className="inline-flex items-center gap-1 text-xs text-violet-600 bg-violet-50 dark:text-violet-300 dark:bg-violet-900/30 rounded-full px-2 py-0.5">
                      <Network size={11} /> {orgName(b.id)}
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-4 border-t border-border space-y-2.5">
                  {/* Platform admin: can reassign org and compound */}
                  {isPlatformAdmin && organizations.length > 0 && (
                    <SelectField value={orgByBuilding[b.id] || '__none__'} onValueChange={(v) => assignOrg(b.id, v === '__none__' ? '' : v)}>
                      <SelectItem value="__none__">{t('buildings.noOrgOption')}</SelectItem>
                      {organizations.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                    </SelectField>
                  )}
                  {(isPlatformAdmin || isOrgAdmin) && visibleCompounds.length > 0 && (
                    <SelectField value={b.compound_id || '__none__'} onValueChange={(v) => assignCompound(b.id, v === '__none__' ? '' : v)}>
                      <SelectItem value="__none__">{t('buildings.noCompoundOption')}</SelectItem>
                      {visibleCompounds.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectField>
                  )}
                  {!b.compound_id ? (
                    <SelectField value={b.billing_mode} onValueChange={(v) => setBuildingMode(b.id, v)}>
                      <SelectItem value="arrears">{t('buildings.modeArrears')}</SelectItem>
                      <SelectItem value="dues">{t('buildings.modeDues')}</SelectItem>
                    </SelectField>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t('buildings.modeViaCompound')}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => toggleActive(b.id, b.is_active)}>
                      {b.is_active ? t('buildings.inactive') : t('buildings.activate')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setMapBuilding(b)}><MapPin size={14} /> {t('buildings.map')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => openEditB(b)}><Pencil size={14} /> {t('common.edit')}</Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Add building modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('buildings.addBuilding')} size="lg">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input label={t('buildings.name')} {...register('name', { required: true })} />
          <Input label={t('buildings.address')} {...register('address', { required: true })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('buildings.city')} {...register('city', { required: true })} />
            <Input label={t('buildings.country')} defaultValue="Lebanon" {...register('country', { required: true })} />
          </div>
          <Input label={t('buildings.contactEmail')} type="email" {...register('contact_email')} />
          <Input label={t('buildings.contactPhone')} type="tel" {...register('contact_phone')} />
          {(isPlatformAdmin || isOrgAdmin) && visibleCompounds.length > 0 && (
            <Controller name="compound_id" control={control} render={({ field }) => (
              <SelectField label={t('buildings.compound')} value={field.value || '__none__'} onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}>
                <SelectItem value="__none__">{t('buildings.noCompoundOption')}</SelectItem>
                {visibleCompounds.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectField>
            )} />
          )}
          <Input label={t('buildings.mapsLink')} placeholder={t('buildings.mapsPlaceholder')} {...register('maps_url')} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting}>{t('common.save')}</Button>
          </div>
        </form>
      </Modal>

      {/* Edit building modal */}
      <Modal open={!!editB} onClose={() => setEditB(null)} title={`${t('common.edit')} — ${editB?.name ?? ''}`} size="lg">
        <div className="space-y-4">
          <Input label={t('buildings.name')} value={ebForm.name} onChange={(e) => setEbForm({ ...ebForm, name: e.target.value })} />
          <Input label={t('buildings.address')} value={ebForm.address} onChange={(e) => setEbForm({ ...ebForm, address: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('buildings.city')} value={ebForm.city} onChange={(e) => setEbForm({ ...ebForm, city: e.target.value })} />
            <Input label={t('buildings.country')} value={ebForm.country} onChange={(e) => setEbForm({ ...ebForm, country: e.target.value })} />
          </div>
          <Input label={t('buildings.contactEmail')} type="email" value={ebForm.contact_email} onChange={(e) => setEbForm({ ...ebForm, contact_email: e.target.value })} />
          <Input label={t('buildings.contactPhone')} type="tel" value={ebForm.contact_phone} onChange={(e) => setEbForm({ ...ebForm, contact_phone: e.target.value })} />
          <Input label={t('buildings.mapsLink')} value={ebForm.maps_url} onChange={(e) => setEbForm({ ...ebForm, maps_url: e.target.value })} />
          <div className="flex justify-between gap-2 pt-2">
            <Button variant="danger" onClick={() => editB && deleteB(editB.id)}><Trash2 size={15} /> {t('common.delete')}</Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditB(null)}>{t('common.cancel')}</Button>
              <Button onClick={saveEditB}>{t('common.save')}</Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Map modal */}
      <Modal open={!!mapBuilding} onClose={() => setMapBuilding(null)} title={mapBuilding?.name ?? ''} size="lg">
        {mapBuilding && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{mapBuilding.address}, {mapBuilding.city}, {mapBuilding.country}</p>
            <div className="rounded-xl overflow-hidden border border-border" style={{ height: 360 }}>
              <iframe title="Building location" src={buildEmbedUrl(mapBuilding)} width="100%" height="100%" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            </div>
            {mapBuilding.maps_url && (
              <a href={mapBuilding.maps_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                <ExternalLink size={14} /> Open in Google Maps
              </a>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
