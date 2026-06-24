import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { Plus, Building2, MapPin, ExternalLink, Boxes } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Building, Compound } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';

type FormData = {
  name: string; address: string; city: string; country: string;
  contact_email: string; contact_phone: string; maps_url: string;
};

function buildEmbedUrl(b: Building): string {
  const query = encodeURIComponent(`${b.address}, ${b.city}, ${b.country}`);
  return `https://maps.google.com/maps?q=${query}&output=embed`;
}

export default function Buildings() {
  const { t } = useTranslation();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [compounds, setCompounds] = useState<Compound[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [compoundModal, setCompoundModal] = useState(false);
  const [compoundForm, setCompoundForm] = useState({ name: '', city: '' });
  const [mapBuilding, setMapBuilding] = useState<Building | null>(null);

  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<FormData>();

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    const [{ data: b }, { data: c }] = await Promise.all([
      supabase.from('buildings').select('*').order('name'),
      supabase.from('compounds').select('*').order('name'),
    ]);
    setBuildings((b as Building[]) ?? []);
    setCompounds((c as Compound[]) ?? []);
    setLoading(false);
  }

  async function onSubmit(data: FormData) {
    const { error } = await supabase.from('buildings').insert({
      name: data.name, address: data.address, city: data.city, country: data.country,
      contact_email: data.contact_email || null, contact_phone: data.contact_phone || null,
      maps_url: data.maps_url || null, is_active: true,
    });
    if (!error) { setModalOpen(false); reset(); loadAll(); }
  }

  async function addCompound() {
    if (!compoundForm.name.trim()) return;
    const { error } = await supabase.from('compounds').insert({ name: compoundForm.name.trim(), city: compoundForm.city.trim() || null });
    if (!error) { setCompoundForm({ name: '', city: '' }); setCompoundModal(false); loadAll(); }
  }

  async function assignCompound(buildingId: string, compoundId: string) {
    await supabase.from('buildings').update({ compound_id: compoundId || null }).eq('id', buildingId);
    loadAll();
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase.from('buildings').update({ is_active: !current }).eq('id', id);
    loadAll();
  }

  const compoundName = (id: string | null) => id ? compounds.find((c) => c.id === id)?.name ?? null : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('buildings.title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('buildings.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { setCompoundForm({ name: '', city: '' }); setCompoundModal(true); }}>
            <Boxes size={16} /> {t('buildings.addCompound')}
          </Button>
          <Button onClick={() => setModalOpen(true)}><Plus size={16} /> {t('buildings.addBuilding')}</Button>
        </div>
      </div>

      {/* Compounds strip */}
      {compounds.length > 0 && (
        <Card className="mb-5">
          <CardBody>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{t('buildings.compounds')}</p>
            <div className="flex flex-wrap gap-2">
              {compounds.map((c) => {
                const count = buildings.filter((b) => b.compound_id === c.id).length;
                return (
                  <div key={c.id} className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 rounded-xl px-3 py-1.5 text-sm">
                    <Boxes size={14} />
                    <span className="font-medium">{c.name}</span>
                    <span className="text-indigo-400 text-xs">· {t('buildings.blocksCount', { count })}</span>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      ) : buildings.length === 0 ? (
        <Card><CardBody><p className="text-sm text-slate-500 text-center py-10">{t('buildings.noBuildings')}</p></CardBody></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {buildings.map((b) => (
            <Card key={b.id} className="transition-shadow hover:shadow-md">
              <CardBody>
                <div className="flex items-start justify-between gap-3">
                  <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                    <Building2 size={20} className="text-indigo-600" />
                  </div>
                  <Badge color={b.is_active ? 'green' : 'slate'}>{b.is_active ? t('buildings.active') : t('buildings.inactive')}</Badge>
                </div>

                <h3 className="font-semibold text-slate-900 mt-3">{b.name}</h3>
                <p className="text-sm text-slate-500">{b.address}</p>
                <p className="text-sm text-slate-500">{b.city}, {b.country}</p>
                {compoundName(b.compound_id) && (
                  <div className="inline-flex items-center gap-1 mt-2 text-xs text-indigo-600 bg-indigo-50 rounded-full px-2 py-0.5">
                    <Boxes size={11} /> {compoundName(b.compound_id)}
                  </div>
                )}

                <div className="mt-4 pt-4 border-t border-slate-100 space-y-2.5">
                  <Select
                    value={b.compound_id ?? ''}
                    onChange={(e) => assignCompound(b.id, e.target.value)}
                    className="text-sm py-2"
                  >
                    <option value="">{t('buildings.noCompoundOption')}</option>
                    {compounds.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => toggleActive(b.id, b.is_active)}>
                      {b.is_active ? t('buildings.inactive') : t('buildings.activate')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setMapBuilding(b)}><MapPin size={14} /> {t('buildings.map')}</Button>
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
          <Input label={t('buildings.mapsLink')} placeholder={t('buildings.mapsPlaceholder')} {...register('maps_url')} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting}>{t('common.save')}</Button>
          </div>
        </form>
      </Modal>

      {/* Add compound modal */}
      <Modal open={compoundModal} onClose={() => setCompoundModal(false)} title={t('buildings.addCompound')} size="sm">
        <div className="space-y-4">
          <Input label={t('buildings.compoundName')} value={compoundForm.name} onChange={(e) => setCompoundForm({ ...compoundForm, name: e.target.value })} placeholder="Marina Gardens" />
          <Input label={t('buildings.cityOptional')} value={compoundForm.city} onChange={(e) => setCompoundForm({ ...compoundForm, city: e.target.value })} />
          <p className="text-xs text-slate-400">{t('buildings.compoundHint')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCompoundModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={addCompound}>{t('buildings.create')}</Button>
          </div>
        </div>
      </Modal>

      {/* Map modal */}
      <Modal open={!!mapBuilding} onClose={() => setMapBuilding(null)} title={mapBuilding?.name ?? ''} size="lg">
        {mapBuilding && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">{mapBuilding.address}, {mapBuilding.city}, {mapBuilding.country}</p>
            <div className="rounded-xl overflow-hidden border border-slate-200" style={{ height: 360 }}>
              <iframe title="Building location" src={buildEmbedUrl(mapBuilding)} width="100%" height="100%" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            </div>
            {mapBuilding.maps_url && (
              <a href={mapBuilding.maps_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:underline">
                <ExternalLink size={14} /> Open in Google Maps
              </a>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
