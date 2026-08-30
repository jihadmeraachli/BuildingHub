import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Map as LeafletMap, Marker } from 'leaflet';
import { MapPin } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/** Free pin picker: Leaflet + OpenStreetMap tiles — no API key, no account.
 *  The pick is saved as a plain Google Maps link (maps?q=lat,lng), so the
 *  existing field, the residents' "Open in Google Maps" link and the embed
 *  all keep working unchanged. */

const BEIRUT: [number, number] = [33.8938, 35.5018];

/** Parse "…maps?q=33.89,35.50…" (the links this picker writes). */
export function coordsFromMapsUrl(url: string | null | undefined): [number, number] | null {
  if (!url) return null;
  const m = url.match(/[?&]q=(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

// Inline SVG pin — leaflet's default marker images don't survive bundling.
const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 30 42">
  <path d="M15 0C6.7 0 0 6.7 0 15c0 11 15 27 15 27s15-16 15-27C30 6.7 23.3 0 15 0z" fill="#e11d48"/>
  <circle cx="15" cy="15" r="6" fill="#fff"/></svg>`;

function MapPickerModal({ open, onClose, value, onPick }: {
  open: boolean;
  onClose: () => void;
  value: string;
  onPick: (url: string) => void;
}) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [picked, setPicked] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !boxRef.current || mapRef.current) return;

      const start = coordsFromMapsUrl(value);
      const map = L.map(boxRef.current).setView(start ?? BEIRUT, start ? 17 : 13);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      const icon = L.divIcon({ html: PIN_SVG, className: '', iconSize: [30, 42], iconAnchor: [15, 40] });
      const place = (lat: number, lng: number) => {
        if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
        else {
          markerRef.current = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
          markerRef.current.on('dragend', () => {
            const p = markerRef.current!.getLatLng();
            setPicked([p.lat, p.lng]);
          });
        }
        setPicked([lat, lng]);
      };
      if (start) place(start[0], start[1]);
      map.on('click', (e: { latlng: { lat: number; lng: number } }) => place(e.latlng.lat, e.latlng.lng));
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      setPicked(null);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal open={open} onClose={onClose} title={t('buildings.mapPickerTitle')} size="lg">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('buildings.mapPickerHint')}</p>
        <div ref={boxRef} dir="ltr" className="rounded-xl overflow-hidden border border-border" style={{ height: 380 }} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="button" disabled={!picked}
            onClick={() => { if (picked) { onPick(`https://www.google.com/maps?q=${picked[0].toFixed(6)},${picked[1].toFixed(6)}`); onClose(); } }}>
            <MapPin size={15} /> {t('buildings.mapPickerUse')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** The Google-Maps-link field with a "Pin on map" companion button. */
export function MapsLinkInput({ label, placeholder, value, onChange }: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
        </div>
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          <MapPin size={15} /> {t('buildings.pinOnMap')}
        </Button>
      </div>
      <MapPickerModal open={open} onClose={() => setOpen(false)} value={value} onPick={onChange} />
    </>
  );
}
