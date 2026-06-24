import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { Plus, Building2, MapPin, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Building } from '@/types';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';

type FormData = {
  name: string;
  address: string;
  city: string;
  country: string;
  contact_email: string;
  contact_phone: string;
  maps_url: string;
};

function buildEmbedUrl(b: Building): string {
  const query = encodeURIComponent(`${b.address}, ${b.city}, ${b.country}`);
  return `https://maps.google.com/maps?q=${query}&output=embed`;
}

export default function Buildings() {
  const { t } = useTranslation();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [mapBuilding, setMapBuilding] = useState<Building | null>(null);

  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<FormData>();

  useEffect(() => { loadBuildings(); }, []);

  async function loadBuildings() {
    setLoading(true);
    const { data } = await supabase.from('buildings').select('*').order('name');
    setBuildings(data ?? []);
    setLoading(false);
  }

  async function onSubmit(data: FormData) {
    const { error } = await supabase.from('buildings').insert({
      name: data.name,
      address: data.address,
      city: data.city,
      country: data.country,
      contact_email: data.contact_email || null,
      contact_phone: data.contact_phone || null,
      maps_url: data.maps_url || null,
      is_active: true,
    });
    if (!error) { setModalOpen(false); reset(); loadBuildings(); }
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase.from('buildings').update({ is_active: !current }).eq('id', id);
    loadBuildings();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-900">{t('buildings.title')}</h1>
        <Button onClick={() => setModalOpen(true)}>
          <Plus size={16} /> {t('buildings.addBuilding')}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      ) : buildings.length === 0 ? (
        <Card><CardBody><p className="text-sm text-slate-500 text-center py-8">{t('buildings.noBuildings')}</p></CardBody></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {buildings.map(b => (
            <Card key={b.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Building2 size={20} className="text-blue-600" />
                  </div>
                  <Badge color={b.is_active ? 'green' : 'slate'}>
                    {b.is_active ? t('buildings.active') : t('buildings.inactive')}
                  </Badge>
                </div>

                <h3 className="font-semibold text-slate-900 mt-3">{b.name}</h3>
                <p className="text-sm text-slate-500">{b.address}</p>
                <p className="text-sm text-slate-500">{b.city}, {b.country}</p>
                {b.contact_email && <p className="text-xs text-slate-400 mt-2">{b.contact_email}</p>}
                {b.contact_phone && <p className="text-xs text-slate-400">{b.contact_phone}</p>}

                <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => toggleActive(b.id, b.is_active)}>
                    {b.is_active ? t('buildings.inactive') : 'Activate'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setMapBuilding(b)}>
                    <MapPin size={14} /> View Map
                  </Button>
                  {b.maps_url && (
                    <a
                      href={b.maps_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      <ExternalLink size={12} /> Open in Maps
                    </a>
                  )}
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
          <div className="flex flex-col gap-1">
            <Input
              label="Google Maps Link (optional)"
              placeholder="Paste the Google Maps share link here"
              {...register('maps_url')}
            />
            <p className="text-xs text-slate-400">
              In Google Maps → share the location → copy link → paste here.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting}>{t('common.save')}</Button>
          </div>
        </form>
      </Modal>

      {/* Map modal */}
      <Modal
        open={!!mapBuilding}
        onClose={() => setMapBuilding(null)}
        title={mapBuilding?.name ?? ''}
        size="lg"
      >
        {mapBuilding && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">{mapBuilding.address}, {mapBuilding.city}, {mapBuilding.country}</p>
            <div className="rounded-lg overflow-hidden border border-slate-200" style={{ height: 360 }}>
              <iframe
                title="Building location"
                src={buildEmbedUrl(mapBuilding)}
                width="100%"
                height="100%"
                style={{ border: 0 }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
            {mapBuilding.maps_url && (
              <a
                href={mapBuilding.maps_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
              >
                <ExternalLink size={14} /> Open in Google Maps
              </a>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
